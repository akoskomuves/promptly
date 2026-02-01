import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CliConfig, ActiveSessionState } from "@getpromptly/shared";

const PROMPTLY_DIR = path.join(os.homedir(), ".promptly");
const CONFIG_FILE = path.join(PROMPTLY_DIR, "config.json");
const SESSION_FILE = path.join(PROMPTLY_DIR, "session.json");

function ensureDir() {
  if (!fs.existsSync(PROMPTLY_DIR)) {
    fs.mkdirSync(PROMPTLY_DIR, { recursive: true });
  }
}

export function loadConfig(): CliConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { apiUrl: "http://localhost:3001", mode: "local" };
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as CliConfig;
    if (!config.mode) config.mode = "local";
    return config;
  } catch {
    return { apiUrl: "http://localhost:3001", mode: "local" };
  }
}

export function isLocalMode(config: CliConfig): boolean {
  return config.mode !== "cloud";
}

export function saveConfig(config: CliConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getActiveSession(): ActiveSessionState | null {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    return JSON.parse(
      fs.readFileSync(SESSION_FILE, "utf-8")
    ) as ActiveSessionState;
  } catch {
    return null;
  }
}

export function saveActiveSession(session: ActiveSessionState): void {
  ensureDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

export function clearActiveSession(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  } catch {
    // ignore
  }
}
