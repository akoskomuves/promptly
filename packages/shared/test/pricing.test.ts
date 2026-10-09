import { describe, it, expect } from "vitest";
import { FALLBACK_MODEL_PRICING, withFallbackPricing } from "../src/pricing";

describe("fallback pricing", () => {
  // The upstream feed lags new releases. As of 2026-07 it carried claude-sonnet-5
  // and claude-opus-4-8 but not claude-opus-5 — the flagship, and the priciest
  // thing most users run.
  it("covers models the feed is missing", () => {
    expect(FALLBACK_MODEL_PRICING["claude-opus-5"]).toBeDefined();
  });

  it("lets live feed data win over the local table", () => {
    const merged = withFallbackPricing({
      "claude-opus-5": { input_price_per_million: 99, output_price_per_million: 199 },
    })!;
    expect(merged["claude-opus-5"].input_price_per_million).toBe(99);
  });

  it("fills gaps the feed leaves", () => {
    const merged = withFallbackPricing({
      "claude-sonnet-5": { input_price_per_million: 2, output_price_per_million: 10 },
    })!;
    expect(merged["claude-sonnet-5"]).toBeDefined();
    expect(merged["claude-opus-5"]).toEqual(FALLBACK_MODEL_PRICING["claude-opus-5"]);
  });

  it("stays null when the fetch failed — no pricing is not the same as fallback pricing", () => {
    expect(withFallbackPricing(null)).toBeNull();
  });
});
