/**
 * LegacyServiceProvider — a {@link MongoDbServiceProvider} implementation
 * backed by `mongodb` driver v3.7, the last stable line that supports the
 * wire protocol of MongoDB 3.0–3.6 servers.
 *
 * The default `NodeDriverServiceProvider` (mongosh) depends on driver v7,
 * which requires MongoDB 4.2+ (wire version ≥ 8). Connecting to an older
 * server fails at the SDAM handshake stage. This adapter lets the MCP server
 * talk to legacy MongoDB 3.x instances by transparently routing the
 * read/metadata tool calls through driver v3.7.
 *
 * Only read & metadata operations are implemented. Write methods throw an
 * explicit error so that misconfiguration surfaces immediately rather than
 * failing silently. Use it together with `MDB_MCP_READ_ONLY=true`.
 */
import mongodb3 from "mongodb-3";
import bson3mod from "bson-3";
import type { MongoClientOptions } from "mongodb-3";
import { deserialize as bson7Deserialize } from "bson";
import { MongoServerError as V7MongoServerError } from "mongodb";
import type {
    AggregateOptions,
    AggregationCursor,
    BulkWriteOptions,
    CountDocumentsOptions,
    CreateCollectionOptions,
    CreateIndexesOptions,
    DeleteOptions,
    DeleteResult,
    Document,
    DropCollectionOptions,
    DropDatabaseOptions,
    FindCursor,
    FindOptions,
    IndexDescription,
    InsertManyResult,
    ListCollectionsOptions,
    ListDatabasesOptions,
    ListIndexesOptions,
    RenameOptions,
    RunCommandOptions,
    SearchIndexDescription,
    UpdateOptions,
    UpdateResult,
} from "mongodb";

import type { MongoDbServiceProvider } from "./serviceProvider.js";

// mongodb@3.7 ships as CommonJS; in ESM we import the default export and
// destructure at runtime. Typed loosely via the ambient declaration.
const { MongoClient } = mongodb3 as unknown as {
    MongoClient: typeof import("mongodb-3").MongoClient;
};

// bson@1.x (the BSON library bundled with mongodb@3.7) — used to re-encode
// documents returned by the legacy driver into the bson@7 wire format the
// rest of the MCP server expects, avoiding BSONVersionError on ObjectId /
// Long / Binary values. bson@1 exposes serialize as an instance method.
const LegacyBSONCtor = (bson3mod as unknown as { BSON: new () => {
    serialize(object: unknown, checkKeys: boolean, asBuffer: boolean, serializeFunctions: boolean): Buffer;
} }).BSON;
const legacyBsonInstance = new LegacyBSONCtor();

/**
 * Converts a document tree returned by mongodb@3.7 (whose BSON types belong
 * to bson@1.x) into bson@7-typed values by round-tripping through the BSON
 * binary wire format. The upper-layer tooling (collectCursorUntilMaxBytes,
 * bsonToJson, hadron-document) all assume bson@7 objects, so this boundary
 * conversion is mandatory when running both drivers in the same process.
 *
 * Arrays are handled element-wise because bson@7's deserialize would otherwise
 * turn them into `{ "0": ..., "1": ... }` objects.
 */
function convertToBson7<T>(doc: unknown): T {
    if (doc === null || doc === undefined) {
        return doc as T;
    }
    if (Array.isArray(doc)) {
        return doc.map((item) => convertToBson7<unknown>(item)) as T;
    }
    const buf = legacyBsonInstance.serialize(doc, false, true, false);
    return bson7Deserialize(buf, { promoteValues: false, promoteBuffers: false }) as T;
}

/* The mongodb@3.7 driver has no first-class TS types (they lived in
 * @types/mongodb). We interact with it through a minimal structural shape and
 * cast at the boundary. Runtime correctness was verified against a live
 * MongoDB 3.4.24 instance — see the probe results in the PR description. */
interface LegacyCursor {
    toArray(): Promise<Document[]>;
    next(): Promise<Document | null>;
    hasNext(): Promise<boolean>;
    close(): Promise<void>;
    explain(verbosity?: string): Promise<Document>;
    limit(n: number): unknown;
    maxTimeMS(ms: number): unknown;
}
interface LegacyCollection {
    find(filter?: Document, options?: Record<string, unknown>): LegacyCursor;
    aggregate(pipeline: Document[], options?: Record<string, unknown>): LegacyCursor;
    countDocuments(filter?: Document, options?: Record<string, unknown>): Promise<number>;
    count(filter?: Document, options?: Record<string, unknown>): Promise<number>;
    listIndexes(): { toArray(): Promise<Document[]> };
}
interface LegacyDb {
    collection(name: string): LegacyCollection;
    aggregate(pipeline: Document[], options?: Record<string, unknown>): LegacyCursor;
    command(spec: Document, options?: Record<string, unknown>): Promise<Document>;
    listCollections(filter?: Document, options?: Record<string, unknown>): { toArray(): Promise<Document[]> };
    admin(): { listDatabases(): Promise<Document> };
}
interface LegacyClient {
    db(name?: string): LegacyDb;
    close(): Promise<void>;
}

/**
 * Wraps a mongodb@3.7 cursor so it quacks like a mongodb@7 `FindCursor` /
 * `AggregationCursor` from the tools' perspective. The only behavioural gap
 * is `tryNext()` (added in driver v4), which we synthesise from
 * `hasNext()`/`next()`.
 */
class LegacyCursorWrapper {
    constructor(private readonly raw: LegacyCursor) {}

    async toArray(): Promise<Document[]> {
        const docs = await this.raw.toArray();
        return convertToBson7<Document[]>(docs);
    }

    async tryNext(): Promise<Document | null> {
        // driver v3 lacks tryNext; emulate non-throwing next-on-exhausted.
        const has = await this.raw.hasNext();
        if (!has) {
            return null;
        }
        const doc = await this.raw.next();
        return convertToBson7<Document | null>(doc);
    }

    async close(): Promise<void> {
        await this.raw.close();
    }

    async explain(verbosity?: string): Promise<Document> {
        const result = await this.raw.explain(verbosity);
        return convertToBson7<Document>(result);
    }

    maxTimeMS(ms: number): this {
        this.raw.maxTimeMS(ms);
        return this;
    }

    limit(n: number): this {
        this.raw.limit(n);
        return this;
    }
}

/** Strips driver-v4+ options that v3.7 does not recognise (e.g. AbortSignal). */
function stripUnsupported(options: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!options) {
        return {};
    }
    const { signal: _signal, ...rest } = options as { signal?: AbortSignal } & Record<string, unknown>;
    return rest;
}

export class LegacyServiceProvider implements MongoDbServiceProvider {
    public readonly initialDb: string;
    private readonly client: LegacyClient;

    constructor(client: LegacyClient, initialDb: string) {
        this.client = client;
        this.initialDb = initialDb;
    }

    /** Establish a connection using driver v3.7. */
    static async connect(connectionString: string): Promise<LegacyServiceProvider> {
        const initialDb = parseInitialDb(connectionString);
        // mongodb@3.7 requires the legacy topology engine flags.
        const client = (await MongoClient.connect(connectionString, {
            useNewUrlParser: true,
            useUnifiedTopology: false,
            serverSelectionTimeoutMS: 10_000,
        } satisfies MongoClientOptions) as unknown) as LegacyClient;
        return new LegacyServiceProvider(client, initialDb);
    }

    private db(name: string): LegacyDb {
        return this.client.db(name || this.initialDb || undefined);
    }

    // ---------- read operations ----------

    find(
        database: string,
        collection: string,
        filter?: Document,
        options?: FindOptions & { signal?: AbortSignal }
    ): FindCursor {
        const opts = stripUnsupported(options as Record<string, unknown> | undefined);
        const raw = this.db(database).collection(collection).find(filter || {}, opts) as unknown as LegacyCursor;
        return new LegacyCursorWrapper(raw) as unknown as FindCursor;
    }

    aggregate(
        database: string,
        collection: string,
        pipeline?: Document[],
        options?: AggregateOptions & { signal?: AbortSignal },
        _dbOptions?: unknown
    ): AggregationCursor {
        const opts = stripUnsupported(options as Record<string, unknown> | undefined);
        const raw = this.db(database)
            .collection(collection)
            .aggregate(pipeline || [], opts) as unknown as LegacyCursor;
        return new LegacyCursorWrapper(raw) as unknown as AggregationCursor;
    }

    aggregateDb(
        database: string,
        pipeline?: Document[],
        options?: AggregateOptions & { signal?: AbortSignal },
        _dbOptions?: unknown
    ): AggregationCursor {
        const opts = stripUnsupported(options as Record<string, unknown> | undefined);
        const raw = this.db(database).aggregate(pipeline || [], opts) as unknown as LegacyCursor;
        return new LegacyCursorWrapper(raw) as unknown as AggregationCursor;
    }

    async countDocuments(
        database: string,
        collection: string,
        filter?: Document,
        options?: CountDocumentsOptions & { signal?: AbortSignal }
    ): Promise<number> {
        const opts = stripUnsupported(options as Record<string, unknown> | undefined);
        const coll = this.db(database).collection(collection);
        try {
            return await coll.countDocuments(filter || {}, opts);
        } catch (error) {
            // countDocuments() runs an aggregation ($group) which is available on
            // 3.4, but some edge builds reject it — fall back to the legacy
            // count command in that case.
            if (error instanceof Error) {
                return await coll.count(filter || {}, opts);
            }
            throw error;
        }
    }

    // ---------- metadata operations ----------

    async listDatabases(database: string, _options?: ListDatabasesOptions): Promise<Document> {
        // The mongosh provider ignores the `database` arg for listing; it always
        // queries the admin database. Mirror that behaviour.
        const result = await this.client.db(database || "admin").admin().listDatabases();
        return convertToBson7<Document>(result);
    }

    async listCollections(
        database: string,
        filter?: Document,
        options?: ListCollectionsOptions & { signal?: AbortSignal }
    ): Promise<Document[]> {
        const opts = stripUnsupported(options as Record<string, unknown> | undefined);
        const docs = await this.db(database).listCollections(filter || {}, opts).toArray();
        return convertToBson7<Document[]>(docs);
    }

    async getIndexes(
        database: string,
        collection: string,
        _options?: ListIndexesOptions
    ): Promise<Document[]> {
        const docs = await this.db(database).collection(collection).listIndexes().toArray();
        return convertToBson7<Document[]>(docs);
    }

    async getSearchIndexes(
        _database: string,
        _collection: string,
        _indexName?: string
    ): Promise<Document[]> {
        // Atlas Search is not available on legacy MongoDB 3.x servers.
        // Throw a SearchNotEnabled-shaped error (using driver v7's
        // MongoServerError so the connection manager's instanceof check
        // in probeSearchCapability classifies search as unsupported).
        throw new V7MongoServerError({
            message: "Atlas Search is not available on legacy MongoDB servers",
            code: 31082,
            codeName: "SearchNotEnabled",
        });
    }

    async runCommand(
        database: string,
        spec?: Document,
        options?: RunCommandOptions & { signal?: AbortSignal }
    ): Promise<Document> {
        const opts = stripUnsupported(options as Record<string, unknown> | undefined);
        const result = await this.db(database).command(spec || {}, opts);
        return convertToBson7<Document>(result);
    }

    async runCommandWithCheck(
        database: string,
        spec?: Document,
        options?: RunCommandOptions & { signal?: AbortSignal }
    ): Promise<Document> {
        const result = await this.runCommand(database, spec, options);
        if (result && result.ok !== 1) {
            const msg = result.errmsg || `Command failed: ${JSON.stringify(spec).slice(0, 200)}`;
            throw new V7MongoServerError({ message: msg, code: result.code, codeName: result.codeName });
        }
        return result;
    }

    // ---------- write operations ----------
    // These are declared so the LegacyServiceProvider satisfies the full
    // MongoDbServiceProvider interface (which write tools type-check against),
    // but they always reject. The intended deployment for legacy servers is
    // `MDB_MCP_READ_ONLY=true`, which prevents write tools from registering.

    private rejectWrite(method: string): never {
        throw new Error(
            `LegacyServiceProvider does not support write operation '${method}'. ` +
                "Enable MDB_MCP_READ_ONLY=true when connecting to legacy MongoDB servers."
        );
    }

    insertMany(
        _database: string,
        _collection: string,
        _docs: Document[],
        _options?: BulkWriteOptions
    ): Promise<InsertManyResult> {
        this.rejectWrite("insertMany");
    }

    createCollection(
        _database: string,
        _collection: string,
        _options?: CreateCollectionOptions
    ): Promise<{ ok: number }> {
        this.rejectWrite("createCollection");
    }

    createIndexes(
        _database: string,
        _collection: string,
        _indexSpecs: IndexDescription[],
        _options?: CreateIndexesOptions
    ): Promise<string[]> {
        this.rejectWrite("createIndexes");
    }

    createSearchIndexes(
        _database: string,
        _collection: string,
        _specs: SearchIndexDescription[]
    ): Promise<string[]> {
        this.rejectWrite("createSearchIndexes");
    }

    updateMany(
        _database: string,
        _collection: string,
        _filter: Document,
        _update: Document | Document[],
        _options?: UpdateOptions
    ): Promise<UpdateResult> {
        this.rejectWrite("updateMany");
    }

    renameCollection(
        _database: string,
        _collection: string,
        _newName: string,
        _options?: RenameOptions
    ): Promise<unknown> {
        this.rejectWrite("renameCollection");
    }

    deleteMany(
        _database: string,
        _collection: string,
        _filter: Document,
        _options?: DeleteOptions
    ): Promise<DeleteResult> {
        this.rejectWrite("deleteMany");
    }

    dropCollection(
        _database: string,
        _collection: string,
        _options?: DropCollectionOptions
    ): Promise<boolean> {
        this.rejectWrite("dropCollection");
    }

    dropDatabase(
        _database: string,
        _options?: DropDatabaseOptions
    ): Promise<{ ok: 0 | 1; dropped?: string }> {
        this.rejectWrite("dropDatabase");
    }

    dropSearchIndex(
        _database: string,
        _collection: string,
        _indexName: string
    ): Promise<void> {
        this.rejectWrite("dropSearchIndex");
    }

    // ---------- lifecycle ----------

    async close(): Promise<void> {
        await this.client.close();
    }
}

/** Extracts the default database name from a connection string. */
function parseInitialDb(connectionString: string): string {
    try {
        // mongodb://user:pass@host:port/dbname?...
        const noCreds = connectionString.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, "mongodb://");
        const afterHost = noCreds.replace(/^mongodb(\+srv)?:\/\/[^/]+/, "");
        const dbPart = (afterHost.split("?")[0] ?? "").replace(/^\//, "");
        return dbPart || "";
    } catch {
        return "";
    }
}
