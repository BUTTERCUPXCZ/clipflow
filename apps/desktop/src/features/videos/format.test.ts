import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatResolution, importPercent } from "./format";

describe("video formatting", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(734 * 1024 ** 2)).toBe("734 MB");
  });

  it("formats durations, with a placeholder until FFprobe has run", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(75.4)).toBe("1:15");
    expect(formatDuration(3 * 3600 + 5 * 60 + 9)).toBe("3:05:09");
  });

  it("formats resolution only when both sides are known", () => {
    expect(formatResolution(1920, 1080)).toBe("1920×1080");
    expect(formatResolution(null, 1080)).toBe("—");
  });

  it("clamps the import percentage and handles an empty size", () => {
    expect(importPercent(50, 200)).toBe(25);
    expect(importPercent(300, 200)).toBe(100);
    expect(importPercent(0, 0)).toBe(0);
  });
});
