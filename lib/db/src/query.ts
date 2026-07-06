import sql, { type Transaction, type IResult } from "mssql";
import { getPool } from "./index";

/**
 * Query parameter map.  Each entry becomes a named parameter (`@name`) on the
 * mssql Request.  The driver infers types from JS values in most cases.  For
 * explicit typing use a tuple: `{ id: [sql.Int, 42] }`.
 */
export type Params = Record<string, unknown | [sql.ISqlType | (() => sql.ISqlType), unknown]>;

function applyParams(req: sql.Request, params?: Params): void {
  if (!params) return;
  for (const [name, val] of Object.entries(params)) {
    if (Array.isArray(val) && val.length === 2 && (typeof val[0] === "function" || typeof val[0] === "object")) {
      // Explicit type tuple: [sql.Int, value]
      req.input(name, val[0] as sql.ISqlType, val[1]);
    } else {
      req.input(name, val);
    }
  }
}

/**
 * Execute a SELECT query and return zero or more rows as type `T`.
 */
export async function queryMany<T = Record<string, unknown>>(query: string, params?: Params): Promise<T[]> {
  const pool = await getPool();
  const req = pool.request();
  applyParams(req, params);
  const result = (await req.query(query)) as IResult<T>;
  return result.recordset as T[];
}

/**
 * Execute a SELECT query and return the first row, or null if none.
 */
export async function queryOne<T = Record<string, unknown>>(query: string, params?: Params): Promise<T | null> {
  const rows = await queryMany<T>(query, params);
  return rows[0] ?? null;
}

/**
 * Execute an INSERT/UPDATE/DELETE statement.  Returns the number of rows
 * affected and, when `returnInsertedId` is true, the identity of the inserted
 * row (for `OUTPUT INSERTED.<col>` queries the caller should use queryOne
 * instead).
 */
export async function execute(query: string, params?: Params): Promise<{ rowsAffected: number }> {
  const pool = await getPool();
  const req = pool.request();
  applyParams(req, params);
  const result = await req.query(query);
  const affected = Array.isArray(result.rowsAffected) ? result.rowsAffected[0] : result.rowsAffected;
  return { rowsAffected: Number(affected ?? 0) };
}

/**
 * Execute a stored procedure.  Returns the first recordset (if any).
 */
export async function callProc<T = Record<string, unknown>>(
  procName: string,
  params?: Params,
): Promise<T[]> {
  const pool = await getPool();
  const req = pool.request();
  applyParams(req, params);
  const result = await req.execute(procName);
  return ((result.recordset as unknown as T[]) ?? []) as T[];
}

/**
 * Run a block of work inside a transaction.  The callback receives a
 * transaction-scoped `queryMany` / `queryOne` / `execute`.  Commits on success,
 * rolls back on any thrown error.
 */
export async function withTransaction<T>(
  fn: (tx: TxHelpers) => Promise<T>,
): Promise<T> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const helpers = makeTxHelpers(transaction);
    const result = await fn(helpers);
    await transaction.commit();
    return result;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export interface TxHelpers {
  queryMany: <T = Record<string, unknown>>(q: string, p?: Params) => Promise<T[]>;
  queryOne: <T = Record<string, unknown>>(q: string, p?: Params) => Promise<T | null>;
  execute: (q: string, p?: Params) => Promise<{ rowsAffected: number }>;
}

function makeTxHelpers(tx: Transaction): TxHelpers {
  return {
    queryMany: async <T>(q: string, p?: Params) => {
      const req = new sql.Request(tx);
      applyParams(req, p);
      const r = (await req.query(q)) as IResult<T>;
      return r.recordset as T[];
    },
    queryOne: async <T>(q: string, p?: Params) => {
      const req = new sql.Request(tx);
      applyParams(req, p);
      const r = (await req.query(q)) as IResult<T>;
      return ((r.recordset as T[])[0] ?? null) as T | null;
    },
    execute: async (q: string, p?: Params) => {
      const req = new sql.Request(tx);
      applyParams(req, p);
      const r = await req.query(q);
      const affected = Array.isArray(r.rowsAffected) ? r.rowsAffected[0] : r.rowsAffected;
      return { rowsAffected: Number(affected ?? 0) };
    },
  };
}

/**
 * Helper to build a `TOP n OFFSET m ROWS FETCH NEXT k ROWS ONLY` clause.
 * SQL Server's paging syntax.
 */
export function paginate(page: number, pageSize: number): { offset: number; fetch: number } {
  const p = Math.max(1, Math.floor(page || 1));
  const s = Math.max(1, Math.min(500, Math.floor(pageSize || 50)));
  return { offset: (p - 1) * s, fetch: s };
}

/**
 * Escape a single identifier (table/column name) for inclusion in dynamic SQL.
 * Returns the name wrapped in square brackets with internal `]` doubled.
 */
export function quoteIdent(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}
