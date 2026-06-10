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

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * True when both dirs are known and belong to different projects.
 * Containment counts as the same project: the session's working directory
 * is often a subdirectory of the project the recording was started in
 * (or vice versa when a recording was started from a subdir).
 */
export function isOtherProject(recordingDir?: string, currentDir?: string): boolean {
  if (!recordingDir || !currentDir) return false;
  return !isWithin(currentDir, recordingDir) && !isWithin(recordingDir, currentDir);
}

function parseContext(data: string): { currentDir?: string } | null {
  try {
    const payload = JSON.parse(data) as {
      workspace?: { current_dir?: string; project_dir?: string };
      cwd?: string;
    };
    // project_dir is the stable project root; current_dir follows the
    // session's shell cwd and may point into a subdirectory
    return {
      currentDir:
        payload.workspace?.project_dir ?? payload.workspace?.current_dir ?? payload.cwd,
    };
  } catch {
    return null;
  }
}

/**
 * Read the JSON payload Claude Code pipes to status line commands.
 * The payload arrives as one small write and the pipe may stay open, so
 * parse eagerly on each chunk instead of waiting for end-of-stream —
 * the status line must render with no artificial delay.
 */
function readStdinContext(timeoutMs = 250): Promise<{ currentDir?: string }> {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((resolve) => {
    let data = "";
    const finish = (result: { currentDir?: string }) => {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.destroy();
      resolve(result);
    };
    // On timeout, still use whatever data arrived — "end" may never fire
    const timer = setTimeout(() => finish(parseContext(data) ?? {}), timeoutMs);
    const onData = (chunk: Buffer) => {
      data += chunk.toString();
      const parsed = parseContext(data);
      if (parsed) finish(parsed);
    };
    const onEnd = () => finish(parseContext(data) ?? {});
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

/** Build the one-line recording indicator, or null when idle/foreign project. */
async function getIndicatorLine(): Promise<string | null> {
  const session = readJson<ActiveSessionState>(SESSION_FILE);
  const buffer = readJson<LocalSession>(BUFFER_FILE);
  if (!session && !buffer) return null;

  // Only show the indicator inside the project the recording belongs to —
  // other Claude Code windows should not display another project's session.
  const { currentDir } = await readStdinContext();
  const recordingDir = session?.projectDir ?? buffer?.projectDir;
  if (isOtherProject(recordingDir, currentDir)) return null;

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
  return parts.join(" · ");
}

/**
 * Print the indicator and exit explicitly. Claude Code holds the stdin pipe
 * open, which keeps node's event loop alive — without the exit the command
 * never terminates and the status line never renders.
 */
async function printIndicator(): Promise<void> {
  const line = await getIndicatorLine();
  if (line === null) process.exit(0);
  process.stdout.write(line + "\n", () => process.exit(0));
  // safety net in case the write callback never fires
  setTimeout(() => process.exit(0), 200);
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

export async function statuslineCommand(action?: string): Promise<void> {
  switch (action) {
    case undefined:
      await printIndicator();
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
