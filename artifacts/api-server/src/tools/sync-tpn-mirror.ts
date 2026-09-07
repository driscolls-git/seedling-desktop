/**
 * TEMPORARY DEV-ONLY BRIDGE — mirrors the three shared TPN reference tables
 * (M_BerryID, M_Locations, M_SrcBreedingProgram) into a local `tpn` schema
 * inside GHSeed.
 *
 * BACKGROUND
 * On 2026-08-31 the dev GHSeed database was migrated to D-NUR-ALI-A1-01 while
 * TPN stayed on WVIDEVGBR-DB01.  The app and ~29 objects inside GHSeed address
 * TPN with three-part names (`TPN.dbo.<table>`), which only resolve when both
 * databases live on the same server, so everything broke with "Invalid object
 * name" / "binding errors".  A linked server was added later but does NOT fix
 * three-part names (those need four parts) and cannot write without MSDTC.
 *
 * CURRENT PLAN: TPN is being migrated to D-NUR-ALI-A1-01 as well.  Once it
 * lands, this bridge is no longer needed.
 *
 * TEARDOWN, in this order, AFTER TPN exists on the server:
 *   1. npx tsx ./src/tools/patch-tpn-views.ts --restore
 *   2. DROP the mirror tables, then the `tpn` schema (see that script's notes).
 * Until step 1 runs, GHSeed's views read this MIRROR, not the real TPN — so
 * skipping it leaves the app quietly serving stale reference data.
 *
 * The mirror is a SNAPSHOT.  Re-run this script to refresh it if anyone edits
 * Programs or Locations in the real TPN while the bridge is still in place.
 * Idempotent, and only ever touches objects in the `tpn` schema.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx ./src/tools/sync-tpn-mirror.ts [--dry-run]
 */
import { sql } from "@workspace/db";

type SqlConfig = ConstructorParameters<typeof sql.ConnectionPool>[0];

const TABLES = ["M_BerryID", "M_Locations", "M_SrcBreedingProgram"] as const;
const SOURCE_SERVER = process.env.TPN_SOURCE_SERVER || "WVIDEVGBR-DB01";
const SOURCE_DB = process.env.TPN_SOURCE_DB || "TPN";
const DRY = process.argv.includes("--dry-run");

interface Col {
  name: string; typ: string; max_length: number; precision: number;
  scale: number; is_nullable: boolean; is_identity: boolean;
}

/** Render a column's SQL type, converting byte lengths back to declared units. */
function typeOf(c: Col): string {
  const t = c.typ.toLowerCase();
  if (["nvarchar", "nchar"].includes(t))
    return `${t}(${c.max_length === -1 ? "max" : c.max_length / 2})`;
  if (["varchar", "char", "varbinary", "binary"].includes(t))
    return `${t}(${c.max_length === -1 ? "max" : c.max_length})`;
  if (["decimal", "numeric"].includes(t)) return `${t}(${c.precision},${c.scale})`;
  if (["datetime2", "time", "datetimeoffset"].includes(t)) return `${t}(${c.scale})`;
  return t;
}

function cfg(server: string, database: string): SqlConfig {
  return {
    server, database, port: 1433,
    user: process.env.SQL_USER, password: process.env.SQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 120_000,
  };
}

async function main() {
  const target = process.env.SQL_SERVER || "";
  console.log(`source : ${SOURCE_SERVER} / ${SOURCE_DB}`);
  console.log(`target : ${target} / ${process.env.SQL_DATABASE} (schema "tpn")`);
  if (DRY) console.log("DRY RUN — no writes\n");

  const src = await new sql.ConnectionPool(cfg(SOURCE_SERVER, SOURCE_DB)).connect();
  const dst = await new sql.ConnectionPool(
    cfg(target.split(",")[0] || target, process.env.SQL_DATABASE || "GHSeed"),
  ).connect();

  // Guard: if TPN is reachable in-database there is no reason to mirror, and
  // doing so would be circular. Protects prod from ever running this.
  const s = (await src.request().query("SELECT @@SERVERNAME n")).recordset[0].n;
  const d = (await dst.request().query("SELECT @@SERVERNAME n")).recordset[0].n;
  if (s === d) {
    console.log(`\nSource and target are the same server (${s}). Mirror not needed — aborting.`);
    await src.close(); await dst.close(); return;
  }

  if (!DRY) {
    await dst.request().query("IF SCHEMA_ID('tpn') IS NULL EXEC('CREATE SCHEMA tpn')");
  }

  for (const t of TABLES) {
    const cols: Col[] = (await src.request().query(
      `SELECT c.name, ty.name AS typ, c.max_length, c.precision, c.scale,
              c.is_nullable, c.is_identity
         FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID('dbo.${t}') ORDER BY c.column_id`)).recordset;
    if (!cols.length) throw new Error(`source table dbo.${t} not found`);

    const rows = (await src.request().query(`SELECT * FROM dbo.${t}`)).recordset;
    console.log(`${t.padEnd(22)} ${String(rows.length).padStart(4)} rows  ` +
      `[${cols.map((c) => c.name + (c.is_identity ? "*" : "")).join(", ")}]`);
    if (DRY) continue;

    const ddl = cols.map((c) =>
      `[${c.name}] ${typeOf(c)}${c.is_identity ? " IDENTITY(1,1)" : ""}` +
      `${c.is_nullable ? " NULL" : " NOT NULL"}`).join(", ");
    await dst.request().query(
      `IF OBJECT_ID('tpn.${t}') IS NULL CREATE TABLE tpn.${t} (${ddl})`);

    // IDENTITY_INSERT is SESSION-scoped, so the toggle, the DELETE and the
    // INSERT must travel as ONE batch on ONE connection. Splitting them across
    // pooled requests is what makes SQL Server report IDENTITY_INSERT as OFF.
    const hasIdentity = cols.some((c) => c.is_identity);
    const names = cols.map((c) => `[${c.name}]`).join(", ");
    const req = dst.request();
    const tuples: string[] = [];
    rows.forEach((row: Record<string, unknown>, ri: number) => {
      cols.forEach((c, ci) => req.input(`p${ri}_${ci}`, row[c.name] ?? null));
      tuples.push(`(${cols.map((_, ci) => `@p${ri}_${ci}`).join(", ")})`);
    });
    const batch = [
      "BEGIN TRANSACTION;",
      hasIdentity ? `SET IDENTITY_INSERT tpn.${t} ON;` : "",
      `DELETE FROM tpn.${t};`,
      tuples.length ? `INSERT INTO tpn.${t} (${names}) VALUES ${tuples.join(", ")};` : "",
      hasIdentity ? `SET IDENTITY_INSERT tpn.${t} OFF;` : "",
      "COMMIT;",
    ].filter(Boolean).join("\n");
    await req.query(batch);
  }

  if (!DRY) {
    console.log("\nverifying:");
    for (const t of TABLES) {
      const n = (await dst.request().query(`SELECT COUNT(*) n FROM tpn.${t}`)).recordset[0].n;
      console.log(`  tpn.${t.padEnd(22)} ${n} rows`);
    }
  }
  await src.close(); await dst.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
