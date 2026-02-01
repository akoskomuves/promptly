import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getActiveSession } from "../config.js";
import type { LocalSession } from "@promptly/shared";

const BUFFER_FILE = path.join(os.homedir(), ".promptly", "buffer.json");

export function statusCommand() {
  const session = getActiveSession();
  if (!session) {
    console.log("No active session.");
    return;
  }

  let buffer: LocalSession | null = null;
  try {
    if (fs.existsSync(BUFFER_FILE)) {
      buffer = JSON.parse(
        fs.readFileSync(BUFFER_FILE, "utf-8")
      ) as LocalSession;
    }
  } catch {
    // ignore
  }

  const elapsed = Date.now() - new Date(session.startedAt).getTime();
  const minutes = Math.floor(elapsed / 60000);

  console.log(`Active session: ${session.ticketId}`);
  console.log(`  Started: ${minutes} minutes ago`);
  console.log(`  Messages: ${buffer?.messageCount ?? 0}`);
  console.log(`  Tokens: ${buffer?.totalTokens ?? 0}`);
}
