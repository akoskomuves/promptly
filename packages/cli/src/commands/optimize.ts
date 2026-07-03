import https from "node:https";
import { listSessionsInRange, listAllSessions } from "../db.js";
import { getAnalytics, getDistinctId } from "../analytics.js";
import {
  runOptimizationDetectors,
  type ModelPricing,
  type OptimizationRecommendation,
} from "@getpromptly/shared";
import { toOptimizeInput } from "../optimize-data.js";
import { applyRecommendation } from "./optimize-apply.js";
import { setAssumeYes } from "../prompts.js";

interface OptimizeOptions {
  from?: string;
  to?: string;
  days?: string;
  json?: boolean;
  apply?: string;
  yes?: boolean;
}

let pricingCache: { data: Record<string, ModelPricing> | null; fetchedAt: number } = {
  data: null,
  fetchedAt: 0,
};

export function fetchPricing(): Promise<Record<string, ModelPricing> | null> {
  const now = Date.now();
  if (pricingCache.data && now - pricingCache.fetchedAt < 3600000) {
    return Promise.resolve(pricingCache.data);
  }
  return new Promise((resolve) => {
    const req = https.get(
      "https://vizra.ai/api/v1/pricing/ai-models",
      { timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            const models = json?.data?.models || json?.models || json;
            pricingCache = { data: models, fetchedAt: now };
            resolve(models);
          } catch {
            resolve(pricingCache.data);
          }
        });
      }
    );
    req.on("error", () => resolve(pricingCache.data));
    req.on("timeout", () => {
      req.destroy();
      resolve(pricingCache.data);
    });
  });
}

function severityTag(sev: OptimizationRecommendation["severity"]): string {
  if (sev === "critical") return "[!!]";
  if (sev === "warning") return "[!]";
  return "[i]";
}

function formatRec(rec: OptimizationRecommendation): string {
  const lines: string[] = [];
  lines.push(
    `${severityTag(rec.severity)} ${rec.title} — est. $${rec.estimatedMonthlySavings.toFixed(2)}/mo savings`
  );
  const wrapped = rec.description.match(/.{1,72}(\s|$)/g) ?? [rec.description];
  for (const line of wrapped) lines.push(`    ${line.trim()}`);
  if (rec.evidence.length > 0) {
    lines.push(`    Top examples:`);
    for (const e of rec.evidence.slice(0, 3)) {
      if (e.kind === "model-misuse") {
        const saved = e.currentCost - e.alternativeCost;
        lines.push(
          `      ${e.ticketId.padEnd(14)} ${e.sessionId.substring(0, 8)}  ${e.model}  $${e.currentCost.toFixed(2)} → $${e.alternativeCost.toFixed(2)} (${e.alternativeModel})  saves $${saved.toFixed(2)}  (q=${e.qualityScore}, ${e.turnsToComplete} turns)`
        );
      } else if (e.kind === "context-bloat") {
        const utilPct = Math.round(e.contextUtilization * 100);
        const peakK = Math.round(e.peakTokenCount / 1000);
        const qLabel = e.qualityScore != null ? `, q=${e.qualityScore}` : "";
        lines.push(
          `      ${e.ticketId.padEnd(14)} ${e.sessionId.substring(0, 8)}  ${e.model}  $${e.totalCost.toFixed(2)} (~$${e.estimatedWaste.toFixed(2)} wasted)  ${utilPct}% ctx, ${peakK}K peak, ${e.summarizationEvents} compaction${e.summarizationEvents === 1 ? "" : "s"}${qLabel}`
        );
      } else if (e.kind === "repeated-correction") {
        const ctx = e.context ? `  "${e.context.substring(0, 60).replace(/\s+/g, " ")}${e.context.length > 60 ? "…" : ""}"` : "";
        lines.push(
          `      ${e.ticketId.padEnd(14)} ${e.sessionId.substring(0, 8)}  said: "${e.originalPhrase}"${ctx}`
        );
      } else if (e.kind === "repetitive-workflow") {
        lines.push(
          `      ${e.ticketId.padEnd(14)} ${e.sessionId.substring(0, 8)}  ran the workflow ${e.occurrenceCount} time${e.occurrenceCount === 1 ? "" : "s"}`
        );
      } else if (e.kind === "pre-post-action") {
        lines.push(
          `      ${e.ticketId.padEnd(14)} ${e.sessionId.substring(0, 8)}  pair ran ${e.occurrences} time${e.occurrences === 1 ? "" : "s"}`
        );
      }
    }
    if (rec.evidence.length > 3) {
      lines.push(`      … and ${rec.evidence.length - 3} more`);
    }
  }
  if (APPLIABLE_TYPES.has(rec.type)) {
    lines.push(`    Apply: promptly optimize --apply "${rec.id}"`);
  }
  return lines.join("\n");
}

const APPLIABLE_TYPES = new Set([
  "repetitive-workflow",
  "repeated-corrections",
  "pre-post-action",
]);

function resolveRange(options: OptimizeOptions): { from: string; to: string; days: number } {
  const to = options.to ? new Date(options.to) : new Date();
  let days: number;
  let from: Date;

  if (options.from) {
    from = new Date(options.from);
    days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
  } else {
    days = options.days ? Math.max(1, parseInt(options.days, 10)) : 90;
    from = new Date(to.getTime() - days * 86400000);
  }

  return { from: from.toISOString(), to: to.toISOString(), days };
}

export async function optimizeCommand(options: OptimizeOptions = {}) {
  const { from, to, days } = resolveRange(options);

  const rows = listSessionsInRange(from, to);

  if (rows.length === 0) {
    if (options.json) {
      console.log("[]");
    } else {
      const allCount = listAllSessions().length;
      console.log(
        `No sessions in the last ${days} days. ${allCount > 0 ? `(You have ${allCount} session${allCount === 1 ? "" : "s"} outside this window — try --days <N> or --from/--to.)` : "Run 'promptly start' to capture some first."}`
      );
    }
    return;
  }

  const pricing = await fetchPricing();
  if (!pricing) {
    if (!options.json) {
      console.error(
        "Could not fetch model pricing from vizra.ai — optimization analysis needs pricing to estimate savings."
      );
    }
    return;
  }

  const recs = runOptimizationDetectors({
    sessions: toOptimizeInput(rows),
    pricing,
    windowDays: days,
  });

  if (options.apply) {
    if (options.yes) setAssumeYes(true);
    const needle = options.apply;
    const rec =
      recs.find((r) => r.id === needle) ??
      recs.find((r) => r.id.startsWith(needle));
    if (!rec) {
      console.error(`No recommendation matches "${needle}" in the last ${days} days.`);
      if (recs.length > 0) {
        console.error("Available ids:");
        for (const r of recs) console.error(`  ${r.id}`);
      }
      process.exitCode = 1;
      return;
    }
    await applyRecommendation(rec);
    getAnalytics().capture({
      distinctId: getDistinctId(),
      event: "optimize rec applied",
      properties: { rec_type: rec.type, window_days: days },
    });
    await getAnalytics().shutdown();
    return;
  }

  const totalSavingsForCapture = recs.reduce((s, r) => s + r.estimatedMonthlySavings, 0);
  getAnalytics().capture({
    distinctId: getDistinctId(),
    event: "optimize run",
    properties: {
      session_count: rows.length,
      recommendation_count: recs.length,
      total_estimated_savings: totalSavingsForCapture,
      window_days: days,
    },
  });
  await getAnalytics().shutdown();

  if (options.json) {
    console.log(JSON.stringify(recs, null, 2));
    return;
  }

  console.log(`Analyzed ${rows.length} session${rows.length === 1 ? "" : "s"} over the last ${days} day${days === 1 ? "" : "s"}.`);
  console.log("");

  if (recs.length === 0) {
    console.log("No optimization opportunities detected. Your AI spend looks efficient.");
    return;
  }

  const totalSavings = recs.reduce((s, r) => s + r.estimatedMonthlySavings, 0);
  console.log(`Estimated monthly savings if all recommendations applied: $${totalSavings.toFixed(2)}`);
  console.log("");

  for (const rec of recs) {
    console.log(formatRec(rec));
    console.log("");
  }
}
