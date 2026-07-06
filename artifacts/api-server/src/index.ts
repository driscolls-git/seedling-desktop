import app from "./app";
import { startAcidTreatNotifier } from "./jobs/acid-treat-notifications";
import { startTransplantNotifier } from "./jobs/transplant-notifications";
import { startSowStartNotifier } from "./jobs/sow-start-notifications";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  if (process.env.ENABLE_NOTIFIERS === "true") {
    startAcidTreatNotifier();
    startTransplantNotifier();
    startSowStartNotifier();
  } else {
    console.log("Background notifiers disabled (set ENABLE_NOTIFIERS=true to enable)");
  }
});
