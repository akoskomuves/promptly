// DB row → OptimizeSessionInput conversion now lives in @getpromptly/shared so
// the CLI optimize command, the dashboard /api/optimize route, and the MCP
// server's PR review all share one implementation. Re-exported here to keep the
// existing `../optimize-data.js` import path stable for callers.

export {
  toOptimizeInput,
  extractUserMessages,
  extractBashSequence,
  type RawSessionRow,
} from "@getpromptly/shared";
