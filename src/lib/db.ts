/** Runs one SQL statement with $1-style parameters and returns its rows. */
export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

/** A database connection that can also run several statements as one transaction. */
export type Db = {
  query: Query;
  transaction<T>(fn: (query: Query) => Promise<T>): Promise<T>;
};
