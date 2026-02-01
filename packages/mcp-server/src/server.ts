import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getActiveSession,
  initBuffer,
  addTurn,
  readBuffer,
  clearBuffer,
  writeToSqlite,
} from "./session.js";
import type { ConversationTurn } from "@promptly/shared";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "promptly",
    version: "0.1.0",
  });

  // Tool: Start a logging session
  server.tool(
    "promptly_start",
    "Start logging AI conversations for a ticket",
    { ticketId: z.string().describe("The ticket ID to log against") },
    async ({ ticketId }) => {
      const existing = getActiveSession();
      if (existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Session already active for ${existing.ticketId}. Run promptly_finish first.`,
            },
          ],
        };
      }

      initBuffer(ticketId);
      return {
        content: [
          {
            type: "text" as const,
            text: `Session started for ${ticketId}. All conversations will be logged.`,
          },
        ],
      };
    }
  );

  // Tool: Log a conversation turn
  server.tool(
    "promptly_log",
    "Log a conversation turn (called automatically during active session)",
    {
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
      model: z.string().optional(),
      tokenCount: z.number().optional(),
    },
    async ({ role, content, model, tokenCount }) => {
      const session = getActiveSession();
      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No active session. Run promptly_start first.",
            },
          ],
        };
      }

      const turn: ConversationTurn = {
        role,
        content,
        timestamp: new Date().toISOString(),
        model,
        tokenCount,
      };

      addTurn(turn);
      return {
        content: [
          { type: "text" as const, text: "Logged." },
        ],
      };
    }
  );

  // Tool: Check session status
  server.tool(
    "promptly_status",
    "Check the current logging session status",
    {},
    async () => {
      const session = getActiveSession();
      const buffer = readBuffer();

      if (!session && !buffer) {
        return {
          content: [
            { type: "text" as const, text: "No active session." },
          ],
        };
      }

      const ticketId = session?.ticketId ?? buffer?.ticketId ?? "unknown";
      const messageCount = buffer?.messageCount ?? 0;
      const totalTokens = buffer?.totalTokens ?? 0;
      const startedAt = session?.startedAt ?? buffer?.startedAt ?? "";

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Active session: ${ticketId}`,
              `Started: ${startedAt}`,
              `Messages: ${messageCount}`,
              `Tokens: ${totalTokens}`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  // Tool: Finish session and return buffer for upload
  server.tool(
    "promptly_finish",
    "Finish the current logging session",
    {},
    async () => {
      const buffer = readBuffer();
      if (!buffer) {
        return {
          content: [
            { type: "text" as const, text: "No active session to finish." },
          ],
        };
      }

      buffer.finishedAt = new Date().toISOString();
      buffer.status = "COMPLETED";

      // Persist to SQLite before clearing buffer
      writeToSqlite(buffer);

      const summary = [
        `Session completed for ${buffer.ticketId}`,
        `Duration: ${formatDuration(buffer.startedAt, buffer.finishedAt)}`,
        `Messages: ${buffer.messageCount}`,
        `Tokens: ${buffer.totalTokens}`,
      ].join("\n");

      clearBuffer();

      return {
        content: [{ type: "text" as const, text: summary }],
      };
    }
  );

  return server;
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m`;
}
