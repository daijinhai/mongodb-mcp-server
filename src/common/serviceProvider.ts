/**
 * Common service provider interface.
 *
 * This abstraction decouples the MCP tools from the concrete driver
 * implementation. The default {@link NodeDriverServiceProvider} (mongosh,
 * backed by `mongodb` driver v7) implements it natively. For legacy MongoDB
 * servers (3.x) that are incompatible with driver v7, the
 * {@link LegacyServiceProvider} (`mongodb` driver v3.7) implements the same
 * surface using TypeScript structural typing.
 *
 * Only the methods consumed by the read/metadata/connect tools are declared
 * here; write-oriented methods are intentionally omitted (they are not
 * registered when `readOnly` mode is enabled).
 */
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

/** Subset of the mongosh service provider used by read/metadata tools. */
export interface MongoDbServiceProvider {
    /** Default database derived from the connection string. */
    readonly initialDb: string;

    // ---- read operations ----
    find(
        database: string,
        collection: string,
        filter?: Document,
        options?: FindOptions & {
            signal?: AbortSignal;
        }
    ): FindCursor;

    aggregate(
        database: string,
        collection: string,
        pipeline?: Document[],
        options?: AggregateOptions & {
            signal?: AbortSignal;
        },
        dbOptions?: unknown
    ): AggregationCursor;

    aggregateDb(
        database: string,
        pipeline?: Document[],
        options?: AggregateOptions & {
            signal?: AbortSignal;
        },
        dbOptions?: unknown
    ): AggregationCursor;

    countDocuments(
        database: string,
        collection: string,
        filter?: Document,
        options?: CountDocumentsOptions & {
            signal?: AbortSignal;
        }
    ): Promise<number>;

    // ---- metadata operations ----
    listDatabases(database: string, options?: ListDatabasesOptions): Promise<Document>;

    listCollections(
        database: string,
        filter?: Document,
        options?: ListCollectionsOptions & {
            signal?: AbortSignal;
        }
    ): Promise<Document[]>;

    getIndexes(
        database: string,
        collection: string,
        options?: ListIndexesOptions
    ): Promise<Document[]>;

    getSearchIndexes(
        database: string,
        collection: string,
        indexName?: string
    ): Promise<Document[]>;

    runCommand(
        database: string,
        spec?: Document,
        options?: RunCommandOptions & {
            signal?: AbortSignal;
        }
    ): Promise<Document>;

    runCommandWithCheck(
        database: string,
        spec?: Document,
        options?: RunCommandOptions & {
            signal?: AbortSignal;
        }
    ): Promise<Document>;

    // ---- write operations (supported by the default provider; the legacy
    //      provider throws NotImplementedError for these, so use readOnly=true
    //      when connecting to legacy servers) ----
    insertMany(
        database: string,
        collection: string,
        docs: Document[],
        options?: BulkWriteOptions
    ): Promise<InsertManyResult>;

    createCollection(
        database: string,
        collection: string,
        options?: CreateCollectionOptions
    ): Promise<{ ok: number }>;

    createIndexes(
        database: string,
        collection: string,
        indexSpecs: IndexDescription[],
        options?: CreateIndexesOptions
    ): Promise<string[]>;

    createSearchIndexes(
        database: string,
        collection: string,
        specs: SearchIndexDescription[]
    ): Promise<string[]>;

    updateMany(
        database: string,
        collection: string,
        filter: Document,
        update: Document | Document[],
        options?: UpdateOptions
    ): Promise<UpdateResult>;

    renameCollection(
        database: string,
        collection: string,
        newName: string,
        options?: RenameOptions
    ): Promise<unknown>;

    deleteMany(
        database: string,
        collection: string,
        filter: Document,
        options?: DeleteOptions
    ): Promise<DeleteResult>;

    dropCollection(
        database: string,
        collection: string,
        options?: DropCollectionOptions
    ): Promise<boolean>;

    dropDatabase(
        database: string,
        options?: DropDatabaseOptions
    ): Promise<{ ok: 0 | 1; dropped?: string }>;

    dropSearchIndex(
        database: string,
        collection: string,
        indexName: string
    ): Promise<void>;

    // ---- lifecycle ----
    close(): Promise<void>;
}
