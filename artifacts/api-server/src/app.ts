import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import path from "path";
import router from "./routes";

const app: Express = express();

// Compress JSON responses — reduces /api/crosses (~6 MB) to ~700 KB on the wire.
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/public", express.static(path.join(process.cwd(), "artifacts/api-server/public")));

app.use("/api", router);

export default app;
