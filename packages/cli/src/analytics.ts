import crypto from "node:crypto";
import { PostHog } from "posthog-node";
import { loadConfig, saveConfig } from "./config.js";

// PostHog public project key — safe to embed in published source (write-only public key).
// Env vars take precedence for dev. Telemetry is gated on cloud mode + login;
// local-only users never trigger a PostHog client initialisation at all.
const POSTHOG_DEFAULT_KEY = "phc_kCqHTxiLsNydTsZ4qo67s3dq2SGg8iy4hKGHtGj36C5r";
const POSTHOG_DEFAULT_HOST = "https://eu.i.posthog.com";

export interface AnalyticsClient {
  capture(args: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): void;
  captureException(
    error: unknown,
    distinctId?: string,
    properties?: Record<string, unknown>
  ): void;
  identify(args: { distinctId: string; properties?: Record<string, unknown> }): void;
  shutdown(): Promise<void>;
}

const NOOP_CLIENT: AnalyticsClient = {
  capture: () => {},
  captureException: () => {},
  identify: () => {},
  shutdown: async () => {},
};

/**
 * Promptly is local-first by default. Telemetry only fires when ALL of:
 *   1. User has explicitly opted into cloud mode (`promptly login` → mode = "cloud", token set)
 *   2. They haven't explicitly disabled it (config.telemetry !== false, env vars not set)
 *
 * Local-mode users send nothing. Ever. Even the PostHog client never initialises.
 * This matches the "your prompts never leave your machine" positioning.
 */
function isTelemetryActive(): boolean {
  if (process.env.PROMPTLY_NO_TELEMETRY === "1" || process.env.PROMPTLY_NO_TELEMETRY === "true") {
    return false;
  }
  if (process.env.DO_NOT_TRACK === "1" || process.env.DO_NOT_TRACK === "true") {
    return false;
  }
  const config = loadConfig();
  if (config.mode !== "cloud") return false;
  if (!config.token) return false;
  if (config.telemetry === false) return false;
  return true;
}

let _client: PostHog | null = null;

export function getAnalytics(): AnalyticsClient {
  if (!isTelemetryActive()) return NOOP_CLIENT;
  if (!_client) {
    _client = new PostHog(
      process.env.POSTHOG_API_KEY ?? POSTHOG_DEFAULT_KEY,
      {
        host: process.env.POSTHOG_HOST ?? POSTHOG_DEFAULT_HOST,
        flushAt: 1,
        flushInterval: 0,
        enableExceptionAutocapture: true,
      }
    );
  }
  return _client;
}

export function getDistinctId(): string {
  const config = loadConfig();
  if (config.userEmail) return config.userEmail;
  if (config.anonymousId) return config.anonymousId;

  const anonymousId = `anon_${crypto.randomUUID()}`;
  config.anonymousId = anonymousId;
  saveConfig(config);
  return anonymousId;
}

/**
 * Gate for the one-time anonymous install ping fired from `promptly init`.
 * Unlike session telemetry (cloud-gated above), this fires in local mode too —
 * it is the only signal that an install ever happened. It is:
 *   - disclosed: init prints a notice with the opt-out alongside the send
 *   - anonymous: random device id; version + OS + node only, never content
 *   - one-shot: config.installPingSent
 *   - opt-out: PROMPTLY_NO_TELEMETRY / DO_NOT_TRACK / `promptly telemetry off`
 */
export function shouldSendInstallPing(): boolean {
  if (process.env.PROMPTLY_NO_TELEMETRY === "1" || process.env.PROMPTLY_NO_TELEMETRY === "true") {
    return false;
  }
  if (process.env.DO_NOT_TRACK === "1" || process.env.DO_NOT_TRACK === "true") {
    return false;
  }
  const config = loadConfig();
  if (config.telemetry === false) return false;
  if (config.installPingSent) return false;
  return true;
}

export async function sendInstallPing(version: string): Promise<void> {
  if (!shouldSendInstallPing()) return;

  // Mark first so a crash mid-send can never cause repeat pings
  const config = loadConfig();
  config.installPingSent = true;
  saveConfig(config);

  try {
    const client = new PostHog(
      process.env.POSTHOG_API_KEY ?? POSTHOG_DEFAULT_KEY,
      {
        host: process.env.POSTHOG_HOST ?? POSTHOG_DEFAULT_HOST,
        flushAt: 1,
        flushInterval: 0,
      }
    );
    client.capture({
      distinctId: getDistinctId(),
      event: "cli installed",
      properties: {
        version,
        os: process.platform,
        node_version: process.versions.node,
      },
    });
    await client.shutdown();
  } catch {
    // never block or fail init over analytics
  }

  console.log(
    "\nPromptly sent a one-time anonymous install ping (version + OS only — never prompt content or paths)."
  );
  console.log(
    "Disable all telemetry any time: promptly telemetry off  (or set PROMPTLY_NO_TELEMETRY=1)"
  );
}

export function setTelemetryEnabled(enabled: boolean): void {
  const config = loadConfig();
  config.telemetry = enabled;
  saveConfig(config);
}

export function getTelemetryStatus(): {
  state: "active" | "disabled-local-mode" | "disabled-not-logged-in" | "disabled-user" | "disabled-env";
  reason: string;
} {
  if (process.env.PROMPTLY_NO_TELEMETRY === "1" || process.env.PROMPTLY_NO_TELEMETRY === "true") {
    return { state: "disabled-env", reason: "PROMPTLY_NO_TELEMETRY environment variable is set." };
  }
  if (process.env.DO_NOT_TRACK === "1" || process.env.DO_NOT_TRACK === "true") {
    return { state: "disabled-env", reason: "DO_NOT_TRACK environment variable is set." };
  }
  const config = loadConfig();
  if (config.mode !== "cloud") {
    return {
      state: "disabled-local-mode",
      reason: "Promptly is in local mode. Telemetry only runs in cloud mode (after `promptly login`).",
    };
  }
  if (!config.token) {
    return {
      state: "disabled-not-logged-in",
      reason: "Cloud mode configured but not logged in. Run `promptly login`.",
    };
  }
  if (config.telemetry === false) {
    return { state: "disabled-user", reason: "Disabled via `promptly telemetry off`." };
  }
  return {
    state: "active",
    reason: "Active in cloud mode. Event names + version + OS only — no prompt content or file paths.",
  };
}
