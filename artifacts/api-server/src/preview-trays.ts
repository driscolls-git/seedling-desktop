// Read-only preview of the tray pipeline for a Berry + Team + Year selection:
// prints the change set a real run would produce, WITHOUT writing anything.
//
//   pnpm --filter @workspace/api-server preview-trays -- <berryId> <teamId> <year>
//
import { closePool } from "@workspace/db";
import { previewTrayPipeline } from "./services/tray-pipeline";

async function main() {
  const [berryId, teamId, year] = process.argv.slice(2).map((a) => parseInt(a, 10));
  if (!berryId || !teamId || !year) {
    console.error("Usage: preview-trays -- <berryId> <teamId> <pollinationYear>");
    process.exit(1);
  }

  const r = await previewTrayPipeline({ berryId, teamId, pollinationYear: year });
  const nullIdx = r.plan.inserts.filter((i) => i.plateIndex == null).length;

  console.log("Tray pipeline PREVIEW — read-only, nothing is written.\n");
  console.log(`  selection      : berry ${berryId}, team ${teamId}, year ${year}`);
  console.log(`  source crosses : ${r.sources} (eligible-build ${r.built}, cancel ${r.cancelled})`);
  console.log(`  computed trays : ${r.computedTrays}`);
  console.log(`  existing rows  : ${r.existingRows}`);
  console.log("");
  console.log(`  INSERT new trays     : ${r.plan.inserts.length}  (NULL plate index: ${nullIdx})`);
  console.log(`  UPDATE Plant_Qty     : ${r.plan.qtyUpdates.length}  (top-ups)`);
  console.log(`  BACKFILL Plate_Index : ${r.plan.plateBackfills.length}  (NULL -> value)`);
  console.log(`  SHIP-ZERO progenies  : ${r.plan.shipZeros.length}  (zero-seed cancellations)`);
  console.log("");
  console.log("  Existing tray codes and non-null plate indexes are never modified.");

  if (r.plan.inserts.length) {
    console.log("\n  sample inserts :", JSON.stringify(r.plan.inserts.slice(0, 3)));
  }
  if (r.plan.qtyUpdates.length) {
    console.log("  sample top-ups :", JSON.stringify(r.plan.qtyUpdates.slice(0, 3)));
  }
  if (r.plan.plateBackfills.length) {
    console.log("  sample backfill:", JSON.stringify(r.plan.plateBackfills.slice(0, 3)));
  }
  if (r.plan.shipZeros.length) {
    console.log("  sample shipZero:", JSON.stringify(r.plan.shipZeros.slice(0, 3)));
  }

  await closePool();
}

main().catch((e) => {
  console.error("PREVIEW FAILED:", e?.message ?? e);
  process.exit(1);
});
