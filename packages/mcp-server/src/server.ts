import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getActiveSession,
  writeActiveSession,
  clearActiveSession,
  initBuffer,
  addTurn,
  readBuffer,
  clearBuffer,
  writeToSqlite,
} from "./session.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { ConversationTurn } from "@getpromptly/shared";
import { reviewPr } from "./review.js";
import { REVIEW_APP_HTML, REVIEW_APP_URI } from "./ui/review-app.js";

/** The project this MCP server instance is running in (Claude Code spawns one per project). */
function currentProjectDir(): string | undefined {
  const cwd = process.cwd();
  return cwd !== "/" ? cwd : undefined;
}

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * True when the recording was started in a different project than this
 * server's. Containment counts as the same project — a recording started
 * via `promptly start` in a subdirectory must still accept this server's
 * turns.
 */
function belongsToOtherProject(recordingDir?: string): boolean {
  const here = currentProjectDir();
  if (!recordingDir || !here) return false;
  return !isWithin(recordingDir, here) && !isWithin(here, recordingDir);
}

function getClientToolName(server: McpServer): string | undefined {
  try {
    const clientInfo = server.server.getClientVersion();
    if (!clientInfo?.name) return undefined;
    return clientInfo.name;
  } catch {
    return undefined;
  }
}

/**
 * The recording handle a caller may pin their call to. MCP 2026-07-28 removed
 * protocol-level sessions in favour of explicit, server-minted handles passed
 * as ordinary tool arguments — this is that argument. Optional so the CLI flow
 * (`promptly start`, which writes session.json without going through
 * promptly_start) keeps working unchanged.
 */
const sessionIdArg = z
  .string()
  .optional()
  .describe(
    "The recording handle returned by promptly_start. Pass it to pin this call to that recording; omit to use whatever recording is active."
  );

/** The handle of the recording currently on disk, from either state file. */
function activeHandle(): string | undefined {
  return getActiveSession()?.sessionId ?? readBuffer()?.sessionId;
}

/**
 * Reject a call whose pinned handle doesn't name the active recording. Returns
 * a reason string, or undefined when the call may proceed. A caller that omits
 * the handle, or an older recording that predates handles, is always allowed —
 * the check only fires on a genuine mismatch.
 */
function handleMismatch(sessionId?: string): string | undefined {
  if (!sessionId) return undefined;
  const active = activeHandle();
  if (!active || active === sessionId) return undefined;
  return `Session handle ${sessionId} does not match the active recording (${active}).`;
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "promptly",
    version: "0.3.0",
  });

  // Tools are registered in a fixed order and never sorted at request time:
  // MCP 2026-07-28 asks servers to return tools/list deterministically so
  // clients can cache the listing and keep LLM prompt-cache hits.

  // Tool: Start a logging session
  server.registerTool(
    "promptly_start",
    {
      title: "Start recording",
      description: "Start logging AI conversations for a ticket",
      inputSchema: {
        ticketId: z.string().optional().describe("The ticket ID to log against (optional)"),
      },
      outputSchema: {
        recording: z.boolean().describe("True when this call started a recording"),
        sessionId: z
          .string()
          .nullable()
          .describe("Handle for this recording — pass to promptly_log/status/finish"),
        ticketId: z.string().describe("The ticket the recording is filed under"),
        alreadyActive: z
          .boolean()
          .describe("True when a recording was already running, so this call was a no-op"),
        projectDir: z.string().nullable().describe("Project the recording belongs to"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ ticketId: rawTicketId }) => {
      const ticketId = rawTicketId || "untitled";
      const existing = getActiveSession();
      if (existing) {
        const where = belongsToOtherProject(existing.projectDir)
          ? ` — started in another project (${existing.projectDir})`
          : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Session already active for ${existing.ticketId}${where}. Run promptly_finish first.`,
            },
          ],
          structuredContent: {
            recording: false,
            sessionId: existing.sessionId,
            ticketId: existing.ticketId,
            alreadyActive: true,
            projectDir: existing.projectDir ?? null,
          },
        };
      }

      const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const externalSessionId = process.env.CLAUDE_CODE_SESSION_ID || undefined;
      const projectDir = currentProjectDir();
      writeActiveSession({
        sessionId,
        ticketId,
        startedAt: new Date().toISOString(),
        apiUrl: "http://localhost:3001",
        externalSessionId,
        projectDir,
      });
      const clientTool = getClientToolName(server);
      initBuffer(ticketId, clientTool, externalSessionId, projectDir, sessionId);
      return {
        content: [
          {
            type: "text" as const,
            text: `🔴 Promptly recording — ${ticketId}. All conversation turns will be logged. Tell the user recording has started (one short line). Finish with promptly_finish when the work wraps up.`,
          },
        ],
        structuredContent: {
          recording: true,
          sessionId,
          ticketId,
          alreadyActive: false,
          projectDir: projectDir ?? null,
        },
      };
    }
  );

  // Tool: Log a conversation turn
  server.registerTool(
    "promptly_log",
    {
      title: "Log a turn",
      description: "Log a conversation turn (called automatically during active session)",
      inputSchema: {
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        model: z.string().optional(),
        tokenCount: z.number().optional(),
        toolCalls: z
          .array(
            z.object({
              name: z.string(),
              input: z.unknown(),
              output: z.unknown().optional(),
              timestamp: z.string().optional(),
            })
          )
          .optional(),
        sessionId: sessionIdArg,
      },
      outputSchema: {
        logged: z.boolean().describe("True when the turn was written to the buffer"),
        reason: z.string().nullable().describe("Why the turn was not logged, when it wasn't"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ role, content, model, tokenCount, toolCalls, sessionId }) => {
      const notLogged = (reason: string) => ({
        content: [{ type: "text" as const, text: `Not logged: ${reason}` }],
        structuredContent: { logged: false, reason },
      });

      const session = getActiveSession();
      const buffer = readBuffer();
      if (!session && !buffer) {
        return notLogged("no active session. Run promptly_start first.");
      }

      const mismatch = handleMismatch(sessionId);
      if (mismatch) return notLogged(mismatch);

      // Never log this project's turns into a recording that belongs to
      // another project — that would silently pollute its session data.
      const recordingDir = session?.projectDir ?? buffer?.projectDir;
      if (belongsToOtherProject(recordingDir)) {
        return notLogged(
          `the active recording (${session?.ticketId ?? buffer?.ticketId}) belongs to another project (${recordingDir}). Finish it there first, or start a session for this project.`
        );
      }

      const turn: ConversationTurn = {
        role,
        content,
        timestamp: new Date().toISOString(),
        model,
        tokenCount,
        ...(toolCalls
          ? {
              toolCalls: toolCalls.map((tc) => ({
                name: tc.name,
                input: tc.input,
                output: tc.output,
                timestamp: tc.timestamp ?? new Date().toISOString(),
              })),
            }
          : {}),
      };

      addTurn(turn);
      return {
        content: [{ type: "text" as const, text: "Logged." }],
        structuredContent: { logged: true, reason: null },
      };
    }
  );

  // Tool: Check session status
  server.registerTool(
    "promptly_status",
    {
      title: "Recording status",
      description: "Check the current logging session status",
      inputSchema: { sessionId: sessionIdArg },
      outputSchema: {
        recording: z
          .boolean()
          .describe("True when a recording is active and accepting this project's turns"),
        sessionId: z.string().nullable().describe("Handle of the active recording"),
        ticketId: z.string().nullable().describe("Ticket the recording is filed under"),
        startedAt: z.string().nullable().describe("ISO timestamp the recording started"),
        messageCount: z.number().describe("Turns buffered so far"),
        totalTokens: z.number().describe("Tokens buffered so far"),
        foreignProject: z
          .boolean()
          .describe("True when a recording is active but belongs to a different project"),
        projectDir: z.string().nullable().describe("Project the recording belongs to"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sessionId }) => {
      const session = getActiveSession();
      const buffer = readBuffer();

      const idle = {
        recording: false,
        sessionId: null,
        ticketId: null,
        startedAt: null,
        messageCount: 0,
        totalTokens: 0,
        foreignProject: false,
        projectDir: null,
      };

      if (!session && !buffer) {
        return {
          content: [{ type: "text" as const, text: "No active session." }],
          structuredContent: idle,
        };
      }

      const mismatch = handleMismatch(sessionId);
      if (mismatch) {
        return {
          content: [{ type: "text" as const, text: mismatch }],
          structuredContent: idle,
        };
      }

      const ticketId = session?.ticketId ?? buffer?.ticketId ?? "unknown";
      const messageCount = buffer?.messageCount ?? 0;
      const totalTokens = buffer?.totalTokens ?? 0;
      const startedAt = session?.startedAt ?? buffer?.startedAt ?? "";
      const recordingDir = session?.projectDir ?? buffer?.projectDir;

      if (belongsToOtherProject(recordingDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `A recording is active for ${ticketId}, but it belongs to another project (${recordingDir}). This project's turns are NOT being logged.`,
            },
          ],
          structuredContent: {
            recording: false,
            sessionId: activeHandle() ?? null,
            ticketId,
            startedAt: startedAt || null,
            messageCount,
            totalTokens,
            foreignProject: true,
            projectDir: recordingDir ?? null,
          },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `🔴 Promptly recording — ${ticketId}`,
              `Started: ${startedAt}`,
              `Messages: ${messageCount}`,
              `Tokens: ${totalTokens}`,
            ].join("\n"),
          },
        ],
        structuredContent: {
          recording: true,
          sessionId: activeHandle() ?? null,
          ticketId,
          startedAt: startedAt || null,
          messageCount,
          totalTokens,
          foreignProject: false,
          projectDir: recordingDir ?? null,
        },
      };
    }
  );

  // Tool: Finish session and return buffer for upload
  server.registerTool(
    "promptly_finish",
    {
      title: "Finish recording",
      description: "Finish the current logging session",
      inputSchema: { sessionId: sessionIdArg },
      outputSchema: {
        saved: z.boolean().describe("True when the session was persisted to SQLite"),
        ticketId: z.string().nullable().describe("Ticket the finished session was filed under"),
        durationMinutes: z.number().nullable().describe("Recording length in minutes"),
        messageCount: z.number().describe("Turns saved"),
        totalTokens: z.number().describe("Tokens saved"),
        error: z.string().nullable().describe("Why the session was not saved, when it wasn't"),
      },
      annotations: {
        readOnlyHint: false,
        // Clears buffer.json and session.json — the recording is gone from
        // the working files once this succeeds.
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sessionId }) => {
      const failed = (error: string, text?: string) => ({
        content: [{ type: "text" as const, text: text ?? error }],
        structuredContent: {
          saved: false,
          ticketId: null,
          durationMinutes: null,
          messageCount: 0,
          totalTokens: 0,
          error,
        },
      });

      const buffer = readBuffer();
      if (!buffer) return failed("No active session to finish.");

      const mismatch = handleMismatch(sessionId);
      if (mismatch) return failed(mismatch);

      buffer.finishedAt = new Date().toISOString();
      buffer.status = "COMPLETED";

      // Persist to SQLite before clearing buffer
      const writeResult = writeToSqlite(buffer);
      if (!writeResult.ok) {
        // Keep buffer.json and session.json so the session can be recovered
        return failed(
          writeResult.error,
          `Failed to save session to the local database: ${writeResult.error}. The conversation buffer was kept at ~/.promptly/buffer.json — run \`promptly finish\` from the CLI to retry.`
        );
      }

      const summary = [
        `⏹ Recording stopped — session saved for ${buffer.ticketId}`,
        `Duration: ${formatDuration(buffer.startedAt, buffer.finishedAt)}`,
        `Messages: ${buffer.messageCount}`,
        `Tokens: ${buffer.totalTokens}`,
      ].join("\n");

      clearBuffer();
      clearActiveSession();

      return {
        content: [{ type: "text" as const, text: summary }],
        structuredContent: {
          saved: true,
          ticketId: buffer.ticketId,
          durationMinutes: durationMinutes(buffer.startedAt, buffer.finishedAt),
          messageCount: buffer.messageCount,
          totalTokens: buffer.totalTokens,
          error: null,
        },
      };
    }
  );

  // The interactive panel promptly_review renders into. Registered before the
  // tool that references it so the resource exists by the time a host preloads
  // it off the tool's _meta.ui.resourceUri.
  registerAppResource(
    server,
    "Prompt Review panel",
    REVIEW_APP_URI,
    { description: "Interactive verdict panel for a PR prompt review" },
    async () => ({
      contents: [{ uri: REVIEW_APP_URI, mimeType: RESOURCE_MIME_TYPE, text: REVIEW_APP_HTML }],
    })
  );

  // Tool: Review the prompts behind a GitHub PR (read-only — not a recording)
  registerAppTool(
    server,
    "promptly_review",
    {
      // Renders the verdict as an interactive panel where the host supports MCP
      // Apps. Hosts that don't still get the prose + structuredContent, so this
      // is additive — nothing regresses without app support.
      _meta: { ui: { resourceUri: REVIEW_APP_URI } },
      title: "Review PR prompts",
      description:
        "Review the AI coding sessions behind a GitHub pull request and return a verdict on prompt quality (LLM-as-judge: intent clarity, scope discipline) and spend (token waste, model misuse, avoidable cost). Call this when the user says they're reviewing a PR (e.g. 'I'm reviewing PR 42', 'let's review #42', 'review this PR'). It analyzes the sessions that PRODUCED the PR; it does NOT start a recording, so do not call promptly_start for review work.",
      inputSchema: {
        prNumber: z.number().int().positive().describe("The GitHub PR number to review"),
      },
      outputSchema: {
        reviewed: z.boolean().describe("True when the review ran"),
        prNumber: z.number().nullable(),
        prTitle: z.string().nullable(),
        sessionCount: z.number().describe("Recorded sessions matched to this PR"),
        totalTokens: z.number(),
        totalCostUsd: z.number(),
        avoidableUsd: z.number().describe("Spend the review judged avoidable"),
        spendEfficiency: z
          .number()
          .nullable()
          .describe("0–10; null when model pricing was unavailable"),
        qualityScore: z
          .number()
          .nullable()
          .describe("0–10 prompt quality; null when the LLM judge did not run"),
        status: z
          .enum(["success", "failure", "error", "pending"])
          .nullable()
          .describe("Pass/fail gate; null when there was nothing to gate on"),
        recommendations: z.array(
          z.object({ id: z.string(), severity: z.string(), title: z.string() })
        ),
        rubrics: z
          .array(
            z.object({
              id: z.string(),
              title: z.string(),
              score10: z.number(),
              worst: z
                .object({ ticketId: z.string(), score: z.number(), note: z.string() })
                .nullable(),
            })
          )
          .describe("Per-rubric judge scores; empty when the judge didn't run"),
        sessions: z
          .array(
            z.object({
              id: z.string(),
              ticketId: z.string(),
              model: z.string().nullable(),
              costUsd: z.number(),
            })
          )
          .describe("The sessions that produced the PR"),
        weakestRubricId: z
          .string()
          .nullable()
          .describe("Rubric scoring lowest — the thing to fix first"),
        error: z.string().nullable().describe("Why the review could not run, when it didn't"),
      },
      annotations: {
        // Reads recorded sessions and the PR; writes nothing.
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        // Shells out to `gh` and calls the Anthropic API for the judge pass.
        openWorldHint: true,
      },
    },
    async ({ prNumber }) => {
      const result = await reviewPr(prNumber);
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: result.text }],
          structuredContent: {
            reviewed: false,
            prNumber,
            prTitle: null,
            sessionCount: 0,
            totalTokens: 0,
            totalCostUsd: 0,
            avoidableUsd: 0,
            spendEfficiency: null,
            qualityScore: null,
            status: null,
            recommendations: [],
            rubrics: [],
            sessions: [],
            weakestRubricId: null,
            error: result.text,
          },
        };
      }
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: { reviewed: true, ...result.summary, error: null },
      };
    }
  );

  return server;
}

function durationMinutes(start: string, end: string): number {
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

function formatDuration(start: string, end: string): string {
  const minutes = durationMinutes(start, end);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m`;
}
