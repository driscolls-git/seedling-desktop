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
