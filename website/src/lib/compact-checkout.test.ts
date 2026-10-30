import { describe, expect, test } from "vitest";
import { bookableDates, formatSlot, packageItems, packageTotal } from "./compact-checkout";

describe("Velovest pricing matrix", () => {
  test("New to Options (Novice) totals $1,080", () => {
    expect(packageTotal("novice")).toBe(1080);
    expect(packageItems("novice")).toHaveLength(5);
  });

  test("Advanced Beginner (Experienced) totals $720 without the two foundation sessions", () => {
    expect(packageTotal("experienced")).toBe(720);
    expect(packageItems("experienced").map(item => item.id)).toEqual(["wheel", "dashboard", "onboarding"]);
  });

  test("Yearly Renewal is $228 of Dashboard Access only", () => {
    expect(packageTotal("renewal")).toBe(228);
    expect(packageItems("renewal").map(item => item.id)).toEqual(["dashboard"]);
  });
});

describe("Onboarding booking in Singapore time", () => {
  test("offers only weekdays, starting the day after today in Singapore", () => {
    // Friday 30 Oct 2026, 23:30 UTC = Saturday 31 Oct 07:30 in Singapore
    const dates = bookableDates(new Date("2026-10-30T23:30:00Z"), 3);
    expect(dates).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  test("labels slots as 60-minute sessions in SGT", () => {
    expect(formatSlot("17:00")).toBe("5:00 PM – 6:00 PM SGT");
  });
});
