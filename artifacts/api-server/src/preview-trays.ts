// Read-only preview of the tray pipeline: prints the change set the next run
// would produce, WITHOUT writing anything to the database.
//
//   pnpm --filter @workspace/api-server preview-trays
//
import { closePool } from "@workspace/db";
import { previewTrayPipeline } from "./services/tray-pipeline";

async function main() {
  const r = await previewTrayPipeline();
  const nullIdx = r.plan.inserts.filter((i) => i.plateIndex == null).length;

  console.log("Tray pipeline PREVIEW — read-only, nothing is written.\n");
  console.log(`  source crosses : ${r.sources} (screened ${r.screened}, non-screened ${r.nonScreened})`);
  console.log(`  computed trays : ${r.computedTrays}`);
  console.log(`  existing rows  : ${r.existingRows}`);
  console.log("");
  console.log(`  INSERT new trays     : ${r.plan.inserts.length}  (NULL plate index: ${nullIdx})`);
  console.log(`  UPDATE Plant_Qty     : ${r.plan.qtyUpdates.length}  (top-ups)`);
  console.log(`  BACKFILL Plate_Index : ${r.plan.plateBackfills.length}  (NULL -> value)`);
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

  await closePool();
}

main().catch((e) => {
  console.error("PREVIEW FAILED:", e?.message ?? e);
  process.exit(1);
});
