import sql, { ConnectionPool, type config as MssqlConfig } from "mssql";

/**
 * Build the mssql config from environment variables.
 *
 * Auth mode:
 *   - If SQL_USER is empty: use Windows Integrated Auth (`trustedConnection`)
 *     via msnodesqlv8 — requires the driver; falls back to SQL auth with empty
 *     credentials if not available. For server deploys, always set SQL_USER +
 *     SQL_PASSWORD.
 *   - Otherwise: SQL Server authentication.
 */
function buildConfig(): MssqlConfig {
  const serverRaw = process.env.SQL_SERVER;
  const database = process.env.SQL_DATABASE;
  if (!serverRaw) throw new Error("SQL_SERVER environment variable is required");
  if (!database) throw new Error("SQL_DATABASE environment variable is required");

  // Accept "host,port" or "host" or "tcp:host,port"
  let server = serverRaw.replace(/^tcp:/i, "");
  let port: number | undefined;
  if (server.includes(",")) {
    const [host, portStr] = server.split(",");
    server = host;
    port = Number(portStr);
  }

  const user = process.env.SQL_USER || "";
  const password = process.env.SQL_PASSWORD || "";

  return {
    server,
    port,
    database,
    user: user || undefined,
    password: password || undefined,
    options: {
      encrypt: process.env.SQL_ENCRYPT === "true",
      trustServerCertificate: process.env.SQL_TRUST_CERT !== "false",
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 1,                     // keep one connection warm to avoid reconnect cost
      idleTimeoutMillis: 300_000, // 5 min — survive idle gaps between user actions
    },
    requestTimeout: 60_000,
  };
}

let _pool: ConnectionPool | null = null;
let _poolPromise: Promise<ConnectionPool> | null = null;

/**
 * Get (or create) the singleton SQL Server connection pool.
 */
export async function getPool(): Promise<ConnectionPool> {
  if (_pool && _pool.connected) return _pool;
  if (_poolPromise) return _poolPromise;

  const config = buildConfig();
  const pool = new sql.ConnectionPool(config);
  _poolPromise = pool.connect().then((p) => {
    _pool = p;
    _poolPromise = null;
    return p;
  });
  return _poolPromise;
}

/**
 * Close the connection pool.  Call on graceful shutdown.
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.close();
    _pool = null;
  }
}

export { sql };
export * from "./query";
export * from "./types";
