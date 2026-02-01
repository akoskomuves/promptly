import {
  loadConfig,
  isLocalMode,
  getActiveSession,
  saveActiveSession,
} from "../config.js";
import { createSession, generateId } from "../db.js";

export async function startCommand(ticketId: string) {
  const existing = getActiveSession();
  if (existing) {
    console.error(
      `Session already active for ${existing.ticketId}. Run 'promptly finish' first.`
    );
    process.exit(1);
  }

  const config = loadConfig();

  if (isLocalMode(config)) {
    const sessionId = generateId();
    createSession(sessionId, ticketId);

    saveActiveSession({
      sessionId,
      ticketId,
      startedAt: new Date().toISOString(),
      apiUrl: config.apiUrl,
    });

    console.log(`Session started for ${ticketId}`);
    console.log("  Recording all AI conversations...");
    console.log("  Run 'promptly finish' when done.");
    console.log("  Run 'promptly serve' to view the dashboard.");
    return;
  }

  // Cloud mode: create session on API
  try {
    const res = await fetch(`${config.apiUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({ ticketId }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to create session: ${res.status} ${text}`);
      process.exit(1);
    }

    const session = (await res.json()) as { id: string };

    saveActiveSession({
      sessionId: session.id,
      ticketId,
      startedAt: new Date().toISOString(),
      apiUrl: config.apiUrl,
    });

    console.log(`Session started for ${ticketId}`);
    console.log("  Recording all AI conversations...");
    console.log("  Run 'promptly finish' when done.");
  } catch (err) {
    console.error(
      `Could not reach API at ${config.apiUrl}. Is it running?`
    );
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
