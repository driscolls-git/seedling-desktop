/**
 * TEMPORARY DEV-ONLY BRIDGE — repoints GHSeed's own views/procs from the TPN
 * database to the local `tpn` mirror schema.  Companion to sync-tpn-mirror.ts,
 * which populates that schema; read its header first for the background.
 *
 * 29 objects inside GHSeed (28 views + sp_GH_SeedlingMaster_Transform_Load_
 * Pipeline) hard-code `TPN.dbo.<table>`.  Changing the application code alone
 * was NOT enough — the views broke too.
 *
 * Every original definition is saved to `tpn._object_backup` before any change.
 *
 * TEARDOWN once TPN exists on this server:
 *   npx tsx ./src/tools/patch-tpn-views.ts --restore
 *   -- then, and only after that succeeds for every object:
 *   DROP TABLE tpn.M_BerryID; DROP TABLE tpn.M_Locations;
 *   DROP TABLE tpn.M_SrcBreedingProgram; DROP TABLE tpn._object_backup;
 *   DROP SCHEMA tpn;
 *
 * NOTE: --restore only works once the TPN database is reachable again.  SQL
 * Server validates object names when creating a VIEW, so restoring a
 * definition that references a nonexistent TPN fails.  Stored procedures use
 * deferred name resolution and WILL restore early, which leaves the database
 * half-reverted — re-run this script without --restore to put it back into a
 * consistent state if that happens.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx ./src/tools/patch-tpn-views.ts [--dry-run|--restore]
 */
import { queryMany, execute, closePool } from "@workspace/db";

const DRY = process.argv.includes("--dry-run");
const RESTORE = process.argv.includes("--restore");

/**
 * Matches every spelling of the cross-database prefix present in this database:
 * `TPN.dbo.`, `TPN.[dbo].`, `[TPN].[dbo].` and whitespace variants.  Whatever
 * object name follows is left untouched, brackets and all.
 */
const TPN_PREFIX_RE = /\[?TPN\]?\s*\.\s*(?:\[?dbo\]?)?\s*\.\s*/gi;

const hasTpnRef = (def: string): boolean => {
  TPN_PREFIX_RE.lastIndex = 0;
  return TPN_PREFIX_RE.test(def);
};

/**
 * Swap CREATE for ALTER so a definition can be re-applied in place.
 * Definitions routinely open with comments or blank lines, so the keyword is
 * matched anywhere rather than anchored to the start; we assert that the swap
 * actually happened instead of assuming a position.
 */
function toAlter(def: string): string {
  const out = def.replace(/\bCREATE(\s+)(VIEW|PROCEDURE|PROC)\b/i, "ALTER$1$2");
  if (out === def) throw new Error("no CREATE VIEW/PROCEDURE keyword found");
  return out;
}

async function main() {
  const srv = (await queryMany<{ s: string }>("SELECT @@SERVERNAME s"))[0].s;
  console.log(`server: ${srv}  mode: ${RESTORE ? "RESTORE" : DRY ? "DRY RUN" : "PATCH"}`);

  // Refuse to run anywhere TPN is reachable in-database (i.e. prod).
  const reachable = await queryMany<{ n: number }>(
    "SELECT COUNT(*) n FROM sys.databases WHERE name = 'TPN'");
  if (reachable[0].n > 0) {
    console.log("TPN exists on this server — patching is unnecessary here. Aborting.");
    return;
  }

  await execute("IF SCHEMA_ID('tpn') IS NULL EXEC('CREATE SCHEMA tpn')");
  await execute(
    `IF OBJECT_ID('tpn._object_backup') IS NULL
       CREATE TABLE tpn._object_backup (
         name sysname NOT NULL PRIMARY KEY,
         type_desc varchar(60) NOT NULL,
         definition nvarchar(max) NOT NULL,
         saved_at datetime2 NOT NULL DEFAULT SYSDATETIME())`);

  if (RESTORE) {
    const saved = await queryMany<{ name: string; definition: string }>(
      "SELECT name, definition FROM tpn._object_backup ORDER BY name");
    console.log(`restoring ${saved.length} objects...`);
    let ok = 0;
    for (const o of saved) {
      try { await execute(toAlter(o.definition)); ok++; }
      catch (e) { console.log(`  FAILED ${o.name}: ${(e as Error).message}`); }
    }
    console.log(`restored ${ok}/${saved.length}`);
    return;
  }

  const objs = (await queryMany<{ name: string; type_desc: string; definition: string }>(
    `SELECT o.name, o.type_desc, sm.definition
       FROM sys.sql_modules sm JOIN sys.objects o ON o.object_id = sm.object_id
      WHERE sm.definition LIKE '%TPN%'
      ORDER BY o.type_desc, o.name`)).filter((o) => hasTpnRef(o.definition));
  console.log(`${objs.length} objects reference the TPN database\n`);

  let patched = 0; const failed: string[] = [];
  for (const o of objs) {
    TPN_PREFIX_RE.lastIndex = 0;
    const hits = (o.definition.match(TPN_PREFIX_RE) || []).length;
    TPN_PREFIX_RE.lastIndex = 0;
    const next = o.definition.replace(TPN_PREFIX_RE, "tpn.");
    console.log(`${o.name.padEnd(46)} ${String(hits).padStart(2)} ref(s)`);
    if (DRY) continue;
    try {
      // Save the ORIGINAL once; never overwrite an existing backup, or a second
      // run would immortalise the already-patched version.
      await execute(
        `IF NOT EXISTS (SELECT 1 FROM tpn._object_backup WHERE name = @n)
           INSERT INTO tpn._object_backup (name, type_desc, definition)
           VALUES (@n, @t, @d)`,
        { n: o.name, t: o.type_desc, d: o.definition });
      await execute(toAlter(next));
      patched++;
    } catch (e) {
      failed.push(`${o.name}: ${(e as Error).message}`);
    }
  }

  if (!DRY) {
    console.log(`\npatched ${patched}/${objs.length}`);
    if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log("  " + f)); }
    const all = await queryMany<{ definition: string }>(
      "SELECT definition FROM sys.sql_modules WHERE definition LIKE '%TPN%'");
    console.log(`objects still referencing the TPN database: ${all.filter((r) => hasTpnRef(r.definition)).length}`);
  }
}
main().then(closePool).catch(async (e) => { console.error("FAILED:", e.message); await closePool(); process.exit(1); });
