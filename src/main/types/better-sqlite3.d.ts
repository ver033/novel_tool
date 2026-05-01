declare module "better-sqlite3" {
  type BindValue = string | number | bigint | Buffer | null;

  interface RunResult {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
  }

  interface Statement {
    all(...params: BindValue[]): Array<Record<string, unknown>>;
    get(...params: BindValue[]): Record<string, unknown> | undefined;
    run(...params: BindValue[]): RunResult;
  }

  interface DatabaseInstance {
    close(): void;
    exec(sql: string): this;
    pragma(sql: string): unknown;
    prepare(sql: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  }

  interface DatabaseOptions {
    readonly fileMustExist?: boolean;
    readonly readonly?: boolean;
    readonly timeout?: number;
    readonly verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
  }

  function Database(filename: string, options?: DatabaseOptions): DatabaseInstance;

  export = Database;
}
