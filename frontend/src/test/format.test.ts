import { describe, expect, it } from "vitest";
import { daysLabel, formatCurrency, formatDate, labelize, toneFor } from "../lib/format";

describe("formatCurrency", () => {
  it("formats INR amounts", () => {
    expect(formatCurrency("2500000")).toContain("25");
    expect(formatCurrency(500000)).toContain("5");
  });
  it("returns an em dash for empty values", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined)).toBe("—");
    expect(formatCurrency("")).toBe("—");
  });
  it("handles non-numeric input gracefully", () => {
    expect(formatCurrency("abc")).toBe("abc");
  });
});

describe("labelize", () => {
  it("humanises snake_case enum values", () => {
    expect(labelize("awaiting_clearance")).toBe("Awaiting Clearance");
    expect(labelize("matured_no_application")).toBe("Matured No Application");
  });
  it("handles empty", () => {
    expect(labelize(null)).toBe("—");
    expect(labelize(undefined)).toBe("—");
  });
});

describe("daysLabel", () => {
  it("describes future, past and today", () => {
    expect(daysLabel(5)).toBe("in 5 days");
    expect(daysLabel(1)).toBe("in 1 day");
    expect(daysLabel(0)).toBe("today");
    expect(daysLabel(-3)).toBe("3 days ago");
    expect(daysLabel(null)).toBe("—");
  });
});

describe("formatDate", () => {
  it("returns em dash for empty", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
  });
});

describe("toneFor", () => {
  it("returns a tone class for known and unknown values", () => {
    expect(toneFor("active")).toContain("emerald");
    expect(toneFor("discrepancies_found")).toContain("rose");
    expect(toneFor("something_unknown")).toContain("slate");
    expect(toneFor(undefined)).toContain("slate");
  });
});
