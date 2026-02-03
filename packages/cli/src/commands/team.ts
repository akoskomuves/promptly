import { select } from "@inquirer/prompts";
import { loadConfig, saveConfig, isLocalMode } from "../config.js";

interface Team {
  id: string;
  name: string;
  slug: string;
}

interface TeamWithMembers extends Team {
  members: { id: string; role: string }[];
  _count: { sessions: number };
}

async function fetchTeams(config: { apiUrl: string; token: string }): Promise<TeamWithMembers[]> {
  const res = await fetch(`${config.apiUrl}/api/teams`, {
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch teams: ${res.status}`);
  }

  const { teams } = (await res.json()) as { teams: TeamWithMembers[] };
  return teams;
}

export async function teamSetCommand(slug?: string) {
  const config = loadConfig();

  if (isLocalMode(config)) {
    console.error("Teams require cloud mode. Run 'promptly login' first.");
    process.exit(1);
  }

  if (!config.token) {
    console.error("Not logged in. Run 'promptly login' first.");
    process.exit(1);
  }

  const token = config.token; // Verified above

  try {
    // If no slug provided, show interactive selector
    if (!slug) {
      const teams = await fetchTeams({ apiUrl: config.apiUrl, token });

      if (teams.length === 0) {
        console.log("No teams available.");
        console.log("Create a team at https://app.getpromptly.xyz/teams");
        process.exit(0);
      }

      const selected = await select({
        message: "Select a team:",
        choices: teams.map((t) => ({
          name: `${t.name} (${t.slug}) - ${t.members.length} members, ${t._count.sessions} sessions`,
          value: t.slug,
          description: config.defaultTeamSlug === t.slug ? "Currently default" : undefined,
        })),
      });

      slug = selected;
    }

    // Verify the team exists and user has access
    const res = await fetch(`${config.apiUrl}/api/teams/${slug}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        console.error(`Team '${slug}' not found.`);
      } else if (res.status === 403) {
        console.error(`You don't have access to team '${slug}'.`);
      } else {
        const text = await res.text();
        console.error(`Failed to verify team: ${res.status} ${text}`);
      }
      process.exit(1);
    }

    const team = (await res.json()) as Team;

    config.defaultTeamSlug = slug;
    saveConfig(config);

    console.log(`Default team set to: ${team.name} (${slug})`);
    console.log("New sessions will be created in this team.");
  } catch (err) {
    console.error(
      `Could not reach API at ${config.apiUrl}. Is it running?`
    );
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

export async function teamUnsetCommand() {
  const config = loadConfig();

  if (!config.defaultTeamSlug) {
    console.log("No default team is currently set.");
    return;
  }

  const previousSlug = config.defaultTeamSlug;
  delete config.defaultTeamSlug;
  saveConfig(config);

  console.log(`Cleared default team (was: ${previousSlug})`);
  console.log("New sessions will be created as personal sessions.");
}

export async function teamCommand(
  action?: string,
  slug?: string
) {
  if (!action) {
    console.log("Usage:");
    console.log("  promptly team set         - Select default team interactively");
    console.log("  promptly team set <slug>  - Set default team by slug");
    console.log("  promptly team unset       - Clear default team");
    console.log("");
    console.log("Run 'promptly teams' to list your teams.");
    return;
  }

  if (action === "set") {
    // slug is optional - if not provided, interactive selector will be shown
    await teamSetCommand(slug);
  } else if (action === "unset") {
    await teamUnsetCommand();
  } else {
    console.error(`Unknown action: ${action}`);
    console.error("Usage: promptly team set <slug> | promptly team unset");
    process.exit(1);
  }
}
