import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the CLI's data directory at a temp dir BEFORE importing modules
// that resolve PROMPTLY_DIR at load time.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "promptly-analytics-test-"));
process.env.PROMPTLY_DIR = tmpDir;

const { shouldSendInstallPing } = await import("../src/analytics");
const { saveConfig, loadConfig } = await import("../src/config");

const CONFIG_FILE = path.join(tmpDir, "config.json");

beforeEach(() => {
  try {
    fs.unlinkSync(CONFIG_FILE);
  } catch {}
  delete process.env.PROMPTLY_NO_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
});

afterEach(() => {
  delete process.env.PROMPTLY_NO_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
});

describe("shouldSendInstallPing", () => {
  it("allows the ping by default on a fresh install", () => {
    expect(shouldSendInstallPing()).toBe(true);
  });

  it("is one-shot: blocked after installPingSent is recorded", () => {
    const config = loadConfig();
    config.installPingSent = true;
    saveConfig(config);
    expect(shouldSendInstallPing()).toBe(false);
  });

  it("respects promptly telemetry off", () => {
    const config = loadConfig();
    config.telemetry = false;
    saveConfig(config);
    expect(shouldSendInstallPing()).toBe(false);
  });

  it("respects PROMPTLY_NO_TELEMETRY and DO_NOT_TRACK", () => {
    process.env.PROMPTLY_NO_TELEMETRY = "1";
    expect(shouldSendInstallPing()).toBe(false);
    delete process.env.PROMPTLY_NO_TELEMETRY;

    process.env.DO_NOT_TRACK = "1";
    expect(shouldSendInstallPing()).toBe(false);
  });
});
