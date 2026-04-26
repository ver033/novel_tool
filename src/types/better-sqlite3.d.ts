declare module "better-sqlite3" {
  export interface Statement<TParams extends unknown[] = unknown[]> {
    run(...params: TParams): { changes: number; lastInsertRowid: number | bigint };
    get(...params: TParams): unknown;
    all(...params: TParams): unknown[];
  }

  export default class Database {
    constructor(filename: string, options?: Record<string, unknown>);
    exec(sql: string): this;
    prepare<TParams extends unknown[] = unknown[]>(sql: string): Statement<TParams>;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
    close(): void;
  }
}
