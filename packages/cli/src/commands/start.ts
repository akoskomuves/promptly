import { input } from "@inquirer/prompts";
import {
  loadConfig,
  saveConfig,
  isLocalMode,
  getActiveSession,
  saveActiveSession,
} from "../config.js";
import { createSession, generateId } from "../db.js";
import { isClaudeConfigured, isSkillInstalledAnywhere } from "./skill.js";

function maybeShowSkillHint(config: ReturnType<typeof loadConfig>): void {
  // Only show hint once
  if (config.skillHintShown) return;

  // Only show if Claude is configured but skill not installed
  if (!isClaudeConfigured()) return;
  if (isSkillInstalledAnywhere()) return;

  console.log("\n  Tip: Install the /track skill for Claude Code:");
  console.log("       promptly skill install\n");

  // Mark hint as shown
  config.skillHintShown = true;
  saveConfig(config);
}

export async function startCommand(ticketId?: string) {
  // Prompt for ticket ID if not provided
  if (!ticketId) {
    ticketId = await input({
      message: "Ticket ID:",
      validate: (value) => value.trim().length > 0 || "Ticket ID is required",
    });
  }
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
    maybeShowSkillHint(config);
    return;
  }

  // Cloud mode: create session on API
  try {
    // Get teamId from default team slug if set
    let teamId: string | undefined;
    if (config.defaultTeamSlug) {
      const teamRes = await fetch(`${config.apiUrl}/api/teams/${config.defaultTeamSlug}`, {
        headers: {
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
      });
      if (teamRes.ok) {
        const team = (await teamRes.json()) as { id: string; name: string };
        teamId = team.id;
      } else {
        console.warn(`Warning: Default team '${config.defaultTeamSlug}' not found. Creating personal session.`);
      }
    }

    const res = await fetch(`${config.apiUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({ ticketId, teamId }),
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
    if (teamId) {
      console.log(`  Team: ${config.defaultTeamSlug}`);
    }
    console.log("  Recording all AI conversations...");
    console.log("  Run 'promptly finish' when done.");
    maybeShowSkillHint(config);
  } catch (err) {
    console.error(
      `Could not reach API at ${config.apiUrl}. Is it running?`
    );
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
