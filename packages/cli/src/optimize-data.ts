// DB row → OptimizeSessionInput conversion.
// Shared by the `optimize` CLI command and the dashboard's /api/optimize route
// so the analysis sees the exact same data shape regardless of caller.

import type { OptimizeSessionInput } from "@getpromptly/shared";
import type { DbSession } from "./db.js";

interface RawTurn {
  role?: string;
  content?: string;
}

export function extractUserMessages(conversationsJson: string): string[] {
  if (!conversationsJson) return [];
  try {
    const turns = JSON.parse(conversationsJson) as RawTurn[];
    if (!Array.isArray(turns)) return [];
    const out: string[] = [];
    for (const t of turns) {
      if (t.role === "user" && typeof t.content === "string" && t.content.length > 0) {
        out.push(t.content);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function toOptimizeInput(rows: DbSession[]): OptimizeSessionInput[] {
  return rows.map((s) => {
    let models: string[] = [];
    try {
      models = JSON.parse(s.models || "[]");
    } catch {}
    let intelligence: OptimizeSessionInput["intelligence"] = null;
    if (s.intelligence) {
      try {
        const intel = JSON.parse(s.intelligence);
        const next: NonNullable<OptimizeSessionInput["intelligence"]> = {};
        if (intel.qualityScore?.overall != null) {
          next.qualityScore = {
            overall: intel.qualityScore.overall,
            turnsToComplete: intel.qualityScore.turnsToComplete ?? 0,
            correctionRate: intel.qualityScore.correctionRate ?? 0,
          };
        }
        if (intel.contextMetrics?.contextUtilization != null) {
          next.contextMetrics = {
            peakTokenCount: intel.contextMetrics.peakTokenCount ?? 0,
            summarizationEvents: intel.contextMetrics.summarizationEvents ?? 0,
            contextUtilization: intel.contextMetrics.contextUtilization,
          };
        }
        if (next.qualityScore || next.contextMetrics) intelligence = next;
      } catch {}
    }
    return {
      id: s.id,
      ticketId: s.ticket_id,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
      totalTokens: s.total_tokens,
      promptTokens: s.prompt_tokens,
      responseTokens: s.response_tokens,
      models,
      intelligence,
      userMessages: extractUserMessages(s.conversations),
    };
  });
}
