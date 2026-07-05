// Model pricing fetch. Uses the global `fetch` (no node builtins) so it stays
// safe to bundle anywhere shared is imported. The CLI keeps its own cached
// node:https fetcher for the optimize command; this is the dependency-free path
// the MCP server uses for PR review.

import type { ModelPricing } from "./optimize.js";

const PRICING_URL = "https://vizra.ai/api/v1/pricing/ai-models";

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
    return models ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
