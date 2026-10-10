import { describe, expect, test } from "vitest";
import { flickSpeed, shouldDismiss } from "./sheet-drag";

describe("sheet drag", () => {
  test("a short, slow drag springs back", () => {
    expect(shouldDismiss(60, 0.1, 700)).toBe(false);
  });

  test("a long drag puts the sheet away, however slowly", () => {
    expect(shouldDismiss(170, 0, 700)).toBe(true);
  });

  test("a short sheet needs a shorter drag: a quarter of its height", () => {
    expect(shouldDismiss(90, 0, 300)).toBe(true);
    expect(shouldDismiss(60, 0, 300)).toBe(false);
  });

  test("a flick puts it away, but not a twitch", () => {
    expect(shouldDismiss(40, 0.9, 700)).toBe(true);
    expect(shouldDismiss(10, 0.9, 700)).toBe(false);
  });

  test("speed is measured over the last 100 ms", () => {
    const samples = [
      { y: 0, t: 0 },
      { y: 10, t: 50 },
      { y: 60, t: 100 },
      { y: 110, t: 150 },
    ];
    expect(flickSpeed(samples, 150)).toBeCloseTo(1, 5); // 100 px between t=50 and t=150
  });

  test("a finger that rested before lifting is not a flick", () => {
    expect(flickSpeed([{ y: 0, t: 0 }, { y: 200, t: 40 }], 400)).toBe(0);
    expect(flickSpeed([], 0)).toBe(0);
  });
});
