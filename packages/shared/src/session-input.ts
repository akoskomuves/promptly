// DB row → OptimizeSessionInput conversion. Lives in shared so the CLI optimize
// command, the dashboard /api/optimize route, and the MCP server's PR review all
// see the exact same data shape regardless of caller.

import { normalizeBashCommand, type OptimizeSessionInput } from "./optimize.js";

// The subset of session columns the conversion reads. DbSession (CLI) and the
// MCP read row are both structural supersets of this.
export interface RawSessionRow {
  id: string;
  ticket_id: string;
  started_at: string;
  finished_at: string | null;
  total_tokens: number;
  prompt_tokens: number;
  response_tokens: number;
  conversations: string;
  models: string;
  intelligence: string | null;
}

interface RawToolCall {
  name?: string;
  input?: unknown;
}

interface RawTurn {
  role?: string;
  content?: string;
  toolCalls?: RawToolCall[];
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

export function extractBashSequence(conversationsJson: string): string[] {
  if (!conversationsJson) return [];
  try {
    const turns = JSON.parse(conversationsJson) as RawTurn[];
    if (!Array.isArray(turns)) return [];
    const seq: string[] = [];
    for (const t of turns) {
      if (!Array.isArray(t.toolCalls)) continue;
      for (const tc of t.toolCalls) {
        if (tc.name !== "Bash") continue;
        const input = tc.input as { command?: unknown } | null | undefined;
        const cmd = input?.command;
        if (typeof cmd !== "string") continue;
        const normalized = normalizeBashCommand(cmd);
        if (normalized) seq.push(normalized);
      }
    }
    return seq;
  } catch {
    return [];
  }
}

export function toOptimizeInput(rows: RawSessionRow[]): OptimizeSessionInput[] {
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
      bashSequence: extractBashSequence(s.conversations),
    };
  });
}
