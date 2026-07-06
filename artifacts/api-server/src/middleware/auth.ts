import { Request, Response, NextFunction } from "express";
import { queryOne } from "@workspace/db";
import type { EmployeeRow } from "@workspace/db";
import crypto from "crypto";

// TOKEN_SECRET signs Seedling-Manager's own session tokens.  Falls back to a
// per-process random secret in development so the server can boot without
// config; in production this MUST be set so tokens survive restarts.
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.TOKEN_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("TOKEN_SECRET environment variable is required in production");
}

// UPLOAD_JWT_SECRET is the shared secret used to mint JWTs for the Flask
// upload app (embedded via iframe in the Upload Data page).  Must match the
// Flask app's JWT_SECRET env var.  No fallback — if missing, the upload-token
// endpoint will throw at request time.
const UPLOAD_JWT_SECRET = process.env.UPLOAD_JWT_SECRET;
if (!UPLOAD_JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("UPLOAD_JWT_SECRET environment variable is required in production");
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    level: number;
    name: string;
  };
}

export function signToken(payload: { id: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");
  return `${data}.${signature}`;
}

/**
 * Mint a standard 3-part JWT (header.payload.signature) compatible with
 * PyJWT / the Flask upload app.  HS256, no expiry for now.
 */
export function signUploadToken(payload: { username: string; id: number }): string {
  if (!UPLOAD_JWT_SECRET) {
    throw new Error("UPLOAD_JWT_SECRET is not configured");
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", UPLOAD_JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): { id: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, signature] = parts;
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

// In-memory cache for the per-request auth DB lookup.  Every authenticated
// request needs to confirm the employee still exists and is active, but doing
// that on every request adds an extra DB round-trip (which on high-latency
// links — e.g. dev laptop talking to a corp DB — dominates request time).
// Cache the resolved user for 60 seconds; logout invalidates client-side
// (token is gone), and active=0 will be picked up within a minute.
interface CachedUser {
  id: number;
  level: number;
  name: string;
  expiresAt: number;
}
const AUTH_CACHE_TTL_MS = 60_000;
const authCache = new Map<number, CachedUser>();

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    const now = Date.now();
    const cached = authCache.get(decoded.id);
    if (cached && cached.expiresAt > now) {
      req.user = { id: cached.id, level: cached.level, name: cached.name };
      next();
      return;
    }

    const emp = await queryOne<Pick<EmployeeRow, "GHEmployee_ID" | "UserLevel_FK" | "Active" | "GH_Employee">>(
      `SELECT GHEmployee_ID, UserLevel_FK, Active, GH_Employee
         FROM dbo.T_GHEmployees
        WHERE GHEmployee_ID = @id`,
      { id: decoded.id },
    );

    if (!emp || emp.Active !== true) {
      authCache.delete(decoded.id);
      res.status(401).json({ message: "User not found or inactive" });
      return;
    }

    const user = {
      id: emp.GHEmployee_ID,
      level: emp.UserLevel_FK ?? 1,
      name: emp.GH_Employee ?? "Unknown",
    };
    authCache.set(decoded.id, { ...user, expiresAt: now + AUTH_CACHE_TTL_MS });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

export async function requireBreeder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (!req.user || req.user.level < 2) {
      res.status(403).json({ message: "Breeder access required" });
      return;
    }
    next();
  });
}

export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (!req.user || req.user.level < 3) {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    next();
  });
}

export async function requireBreederOnly(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (!req.user || req.user.level !== 2) {
      res.status(403).json({ message: "Breeder access required" });
      return;
    }
    next();
  });
}

export async function requireMarkerEditor(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (!req.user || (req.user.level !== 4 && req.user.level !== 5)) {
      res.status(403).json({ message: "Admin3 or Molecular access required" });
      return;
    }
    next();
  });
}
