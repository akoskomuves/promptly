// Model pricing fetch. Uses the global `fetch` (no node builtins) so it stays
// safe to bundle anywhere shared is imported. The CLI keeps its own cached
// node:https fetcher for the optimize command; this is the dependency-free path
// the MCP server uses for PR review.

import type { ModelPricing } from "./optimize.js";

const PRICING_URL = "https://vizra.ai/api/v1/pricing/ai-models";

/**
 * Prices for models the upstream feed doesn't carry yet.
 *
 * The feed lags new releases — as of 2026-07 it knows `claude-sonnet-5` and
 * `claude-opus-4-8` but not `claude-opus-5`, which is the flagship and the most
 * expensive thing most users run. A missing entry used to make a session cost
 * $0, so the priciest work in a PR read as free and the review reported a clean
 * spend score. This map closes the gap for models we know about; anything still
 * unknown is reported as unpriced rather than free (see `PrReviewVerdict.unpricedSessions`).
 *
 * USD per million tokens. Keep in sync when a new model ships; entries here are
 * overridden by the feed as soon as it catches up.
 */
export const FALLBACK_MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": { input_price_per_million: 5, output_price_per_million: 25 },
};

/**
 * Merge fetched pricing over the fallback map. The feed wins on conflict, so a
 * stale local entry can never override live upstream data.
 */
export function withFallbackPricing(
  fetched: Record<string, ModelPricing> | null
): Record<string, ModelPricing> | null {
  if (!fetched) return null;
  return { ...FALLBACK_MODEL_PRICING, ...fetched };
}

export async function fetchModelPricing(
  timeoutMs = 5000
): Promise<Record<string, ModelPricing> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(PRICING_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { models?: Record<string, ModelPricing> };
      models?: Record<string, ModelPricing>;
    };
    const models = json?.data?.models ?? json?.models ?? (json as Record<string, ModelPricing>);
    return withFallbackPricing(models ?? null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
