import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ActiveSessionState, LocalSession } from "@getpromptly/shared";

const PROMPTLY_DIR =
  process.env.PROMPTLY_DIR ?? path.join(os.homedir(), ".promptly");
const SESSION_FILE = path.join(PROMPTLY_DIR, "session.json");
const BUFFER_FILE = path.join(PROMPTLY_DIR, "buffer.json");

const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const STATUSLINE_COMMAND = "promptly statusline";

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatElapsed(startedAt: string): string | null {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Print the one-line recording indicator. Prints nothing when idle. */
function printIndicator(): void {
  const session = readJson<ActiveSessionState>(SESSION_FILE);
  const buffer = readJson<LocalSession>(BUFFER_FILE);
  if (!session && !buffer) return;

  const ticketId = session?.ticketId ?? buffer?.ticketId ?? "untitled";
  const startedAt = session?.startedAt ?? buffer?.startedAt;

  const parts = [`🔴 REC ${ticketId}`];
  if (buffer) {
    parts.push(`${buffer.messageCount} msgs`);
    parts.push(`${formatTokens(buffer.totalTokens)} tok`);
  }
  if (startedAt) {
    const elapsed = formatElapsed(startedAt);
    if (elapsed) parts.push(elapsed);
  }
  console.log(parts.join(" · "));
}

function install(): void {
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf-8"));
    } catch (err) {
      console.error(
        `Could not parse ${CLAUDE_SETTINGS} (${err instanceof Error ? err.message : err}). Not touching it.`
      );
      printManualInstructions();
      process.exitCode = 1;
      return;
    }
  }

  const existing = settings.statusLine as { command?: string } | undefined;
  if (existing && !existing.command?.includes(STATUSLINE_COMMAND)) {
    console.log(
      "You already have a custom status line in Claude Code settings. Not overwriting it."
    );
    console.log(
      `To chain Promptly into it, append: ${STATUSLINE_COMMAND}`
    );
    printManualInstructions();
    return;
  }

  settings.statusLine = { type: "command", command: STATUSLINE_COMMAND };
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  console.log(`Status line installed in ${CLAUDE_SETTINGS.replace(os.homedir(), "~")}.`);
  console.log(
    "Claude Code will now show 🔴 REC <ticket> while a Promptly session is active. Restart Claude Code to activate."
  );
}

function uninstall(): void {
  const settings = readJson<Record<string, unknown>>(CLAUDE_SETTINGS);
  const statusLine = settings?.statusLine as { command?: string } | undefined;
  if (!settings || !statusLine?.command?.includes(STATUSLINE_COMMAND)) {
    console.log("Promptly status line is not installed. Nothing to do.");
    return;
  }
  delete settings.statusLine;
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  console.log("Promptly status line removed from Claude Code settings.");
}

function printManualInstructions(): void {
  console.log("\nManual setup — add this to ~/.claude/settings.json:");
  console.log(
    JSON.stringify({ statusLine: { type: "command", command: STATUSLINE_COMMAND } }, null, 2)
  );
}

export function statuslineCommand(action?: string): void {
  switch (action) {
    case undefined:
      printIndicator();
      break;
    case "install":
      install();
      break;
    case "uninstall":
      uninstall();
      break;
    default:
      console.error(`Unknown action: ${action}. Use: promptly statusline [install | uninstall]`);
      process.exitCode = 1;
  }
}
