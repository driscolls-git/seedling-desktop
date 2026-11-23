import { describe, it, expect } from "vitest";
import { parsePlateIndexInput, plateLabelExpr } from "./plate-label";

describe("parsePlateIndexInput — plate filter accepts number or printed label", () => {
  it("accepts a bare number", () => {
    expect(parsePlateIndexInput("322")).toBe(322);
    expect(parsePlateIndexInput(322)).toBe(322);
  });

  it("accepts the printed label and strips the year and berry prefix", () => {
    expect(parsePlateIndexInput("26BU0322")).toBe(322);
    expect(parsePlateIndexInput("25RA0171")).toBe(171);
    expect(parsePlateIndexInput("26bu0001")).toBe(1);
    expect(parsePlateIndexInput(" 26BU0322 ")).toBe(322);
  });

  it("still accepts the older label without a year", () => {
    expect(parsePlateIndexInput("BU0322")).toBe(322);
    expect(parsePlateIndexInput("RA0171")).toBe(171);
    expect(parsePlateIndexInput("bu0001")).toBe(1);
  });

  it("drops leading zeros rather than producing an octal-ish surprise", () => {
    expect(parsePlateIndexInput("0001")).toBe(1);
    expect(parsePlateIndexInput("BK10000")).toBe(10000);
    expect(parsePlateIndexInput("26BK10000")).toBe(10000);
  });

  it("returns null when there is no number to filter on", () => {
    for (const v of [null, undefined, "", "   ", "BU", "abc", "26BU"]) {
      expect(parsePlateIndexInput(v)).toBeNull();
    }
  });

  it("only takes the digits that directly follow the letters", () => {
    expect(parsePlateIndexInput("BU 0322 ")).toBe(322);
    expect(parsePlateIndexInput("BU-0322")).toBe(322);
    expect(parsePlateIndexInput("BU12-34")).toBeNull();
  });

  it("stays fast on very long input (no regex backtracking)", () => {
    const started = Date.now();
    expect(parsePlateIndexInput("A" + "a".repeat(200_000))).toBeNull();
    expect(parsePlateIndexInput("A" + "a".repeat(200_000) + "7")).toBe(7);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("plateLabelExpr — SQL shape", () => {
  it("is NULL-safe and never truncates an index above the pad width", () => {
    const sql = plateLabelExpr("v.Plate_Index", "v.Berry", "v.Pollination_Year");
    expect(sql).toContain("WHEN v.Plate_Index IS NULL THEN NULL");
    expect(sql).toContain("> 9999");
    expect(sql).toContain("RIGHT('0000'");
  });

  it("prefixes the two-digit year", () => {
    const sql = plateLabelExpr("v.Plate_Index", "v.Berry", "v.Pollination_Year");
    expect(sql).toContain("v.Pollination_Year % 100");
  });

  it("interpolates whichever columns it is given", () => {
    const sql = plateLabelExpr("tr.startingPlateIndex", "v.Berry", "v.Pollination_Year");
    expect(sql).toContain("tr.startingPlateIndex");
    expect(sql).not.toContain("v.Plate_Index");
  });
});
