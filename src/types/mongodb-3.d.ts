/**
 * Minimal ambient declarations for the `mongodb-3` alias package
 * (npm alias for `mongodb@^3.7.4`), which ships without its own
 * TypeScript definitions (driver v3 relied on @types/mongodb).
 *
 * Only the surface used by {@link LegacyServiceProvider} is declared.
 * Values imported from `mongodb-3` are runtime-typed as `any` here and
 * cast at their usage sites; correctness comes from the v7 type imports
 * used for the public interface in `serviceProvider.ts`.
 */

declare module "bson-3" {
    /** bson@1.x BSON serializer/deserializer (used by mongodb@3.7). */
    export class BSON {
        serialize(object: unknown, checkKeys: boolean, asBuffer: boolean, serializeFunctions: boolean): Buffer;
        deserialize(buffer: Buffer): unknown;
    }
    const _default: { BSON: typeof BSON; [key: string]: unknown };
    export default _default;
}

declare module "mongodb-3" {
    export interface MongoClientOptions {
        useNewUrlParser?: boolean;
        useUnifiedTopology?: boolean;
        serverSelectionTimeoutMS?: number;
        socketTimeoutMS?: number;
        [key: string]: unknown;
    }

    export interface MongoError extends Error {
        code?: number;
        codeName?: string;
        errmsg?: string;
    }

    export class MongoServerError extends Error {
        code?: number;
        codeName?: string;
        errmsg?: string;
        constructor(options?: {
            message?: string;
            code?: number;
            codeName?: string;
            errmsg?: string;
            [key: string]: unknown;
        });
    }

    /** A connected mongodb@3.7 client (loosely typed). */
    export class MongoClient {
        static connect(uri: string, options?: MongoClientOptions): Promise<MongoClient>;
        db(name?: string): unknown;
        close(force?: boolean): Promise<void>;
    }
}
