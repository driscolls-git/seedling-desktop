import { Router, type IRouter } from "express";
import { queryOne, queryMany } from "@workspace/db";
import type { EmployeeRow, TeamRow } from "@workspace/db";
import { LoginBody, LoginResponse } from "@workspace/api-zod";
import {
  signToken,
  signUploadToken,
  verifyToken,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res) => {
  try {
    const body = LoginBody.parse(req.body);
    const emp = await queryOne<EmployeeRow>(
      `SELECT GHEmployee_ID, GH_Employee, Employee_Num, Team_ID, Active, UserLevel_FK, Email
         FROM dbo.T_GHEmployees
        WHERE GHEmployee_ID = @id AND Employee_Num = @empNum`,
      { id: body.employeeId, empNum: body.employeeNum },
    );

    if (!emp) {
      res.status(401).json({ success: false, message: "Invalid credentials" });
      return;
    }

    let teamName: string | undefined;
    if (emp.Team_ID) {
      const team = await queryOne<Pick<TeamRow, "Team_Name">>(
        `SELECT Team_Name FROM dbo.M_GHTeams WHERE Team_ID = @id`,
        { id: emp.Team_ID },
      );
      teamName = team?.Team_Name ?? undefined;
    }

    const response = LoginResponse.parse({
      success: true,
      employee: {
        id: emp.GHEmployee_ID,
        ghEmployee: emp.GH_Employee,
        employeeNum: emp.Employee_Num,
        teamId: emp.Team_ID,
        teamName,
        active: emp.Active === true,
        userLevelFk: emp.UserLevel_FK,
        email: emp.Email ?? undefined,
      },
      token: signToken({ id: emp.GHEmployee_ID }),
    });

    res.json(response);
  } catch (error: unknown) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Bad request" });
  }
});

router.get("/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    const emp = await queryOne<EmployeeRow>(
      `SELECT GHEmployee_ID, GH_Employee, Employee_Num, Team_ID, Active, UserLevel_FK, Email
         FROM dbo.T_GHEmployees
        WHERE GHEmployee_ID = @id`,
      { id: decoded.id },
    );

    if (!emp) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    let teamName: string | undefined;
    if (emp.Team_ID) {
      const team = await queryOne<Pick<TeamRow, "Team_Name">>(
        `SELECT Team_Name FROM dbo.M_GHTeams WHERE Team_ID = @id`,
        { id: emp.Team_ID },
      );
      teamName = team?.Team_Name ?? undefined;
    }

    res.json({
      id: emp.GHEmployee_ID,
      ghEmployee: emp.GH_Employee,
      employeeNum: emp.Employee_Num,
      teamId: emp.Team_ID,
      teamName,
      active: emp.Active === true,
      userLevelFk: emp.UserLevel_FK,
      email: emp.Email,
    });
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
});

router.get("/employees", async (req, res) => {
  try {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (req.query.active !== undefined) {
      clauses.push("e.Active = @active");
      params.active = req.query.active === "true" ? 1 : 0;
    }
    if (req.query.teamId) {
      clauses.push("e.Team_ID = @teamId");
      params.teamId = parseInt(String(req.query.teamId));
    }
    if (req.query.name) {
      clauses.push("e.GH_Employee LIKE @name");
      params.name = `%${String(req.query.name)}%`;
    }
    if (req.query.userLevelFk) {
      clauses.push("e.UserLevel_FK = @userLevelFk");
      params.userLevelFk = parseInt(String(req.query.userLevelFk));
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const authHeader = req.headers.authorization;
    let isAuthenticated = false;
    if (authHeader?.startsWith("Bearer ")) {
      const decoded = verifyToken(authHeader.slice(7));
      isAuthenticated = decoded !== null;
    }

    if (isAuthenticated) {
      const rows = await queryMany<
        EmployeeRow & { Team_Name: string | null }
      >(
        `SELECT e.GHEmployee_ID, e.GH_Employee, e.Employee_Num, e.Team_ID, t.Team_Name,
                e.Active, e.UserLevel_FK, e.Email, e.Modified_DateTime, e.Modified_By
           FROM dbo.T_GHEmployees e
           LEFT JOIN dbo.M_GHTeams t ON e.Team_ID = t.Team_ID
           ${where}
          ORDER BY e.GH_Employee`,
        params,
      );
      res.json(
        rows.map((r) => ({
          id: r.GHEmployee_ID,
          ghEmployee: r.GH_Employee,
          employeeNum: r.Employee_Num,
          teamId: r.Team_ID,
          teamName: r.Team_Name ?? null,
          active: r.Active === true,
          userLevelFk: r.UserLevel_FK,
          email: r.Email,
          modifiedDate: r.Modified_DateTime ? new Date(r.Modified_DateTime).toLocaleDateString() : null,
          modifiedBy: r.Modified_By ?? null,
        })),
      );
    } else {
      const rows = await queryMany<Pick<EmployeeRow, "GHEmployee_ID" | "GH_Employee" | "Active">>(
        `SELECT e.GHEmployee_ID, e.GH_Employee, e.Active
           FROM dbo.T_GHEmployees e
           ${where}`,
        params,
      );
      res.json(
        rows.map((r) => ({
          id: r.GHEmployee_ID,
          ghEmployee: r.GH_Employee,
          active: r.Active === true,
        })),
      );
    }
  } catch (error: unknown) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Internal server error" });
  }
});

router.get("/auth/upload-token", requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user!;
  const uploadToken = signUploadToken({ username: user.name, id: user.id });
  const uploadAppUrl = process.env.UPLOAD_APP_URL || "http://localhost:5000";
  res.json({ token: uploadToken, uploadAppUrl });
});

export default router;
