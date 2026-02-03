import { select } from "@inquirer/prompts";
import open from "open";
import { loadConfig, saveConfig, isLocalMode } from "../config.js";

interface TeamMember {
  id: string;
  role: string;
  user: { id: string; email: string; name: string | null };
}

interface Team {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  members: TeamMember[];
  _count: { sessions: number };
}

export async function teamsCommand() {
  const config = loadConfig();

  if (isLocalMode(config)) {
    console.error("Teams require cloud mode. Run 'promptly login' first.");
    process.exit(1);
  }

  if (!config.token) {
    console.error("Not logged in. Run 'promptly login' first.");
    process.exit(1);
  }

  try {
    const res = await fetch(`${config.apiUrl}/api/teams`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to fetch teams: ${res.status} ${text}`);
      process.exit(1);
    }

    const { teams } = (await res.json()) as { teams: Team[] };

    if (teams.length === 0) {
      console.log("No teams yet.");
      console.log("Create a team at https://app.getpromptly.xyz/teams");
      return;
    }

    console.log("Your teams:\n");

    for (const team of teams) {
      const currentMember = team.members.find(
        (m) => m.user.email === config.userEmail
      );
      const role = currentMember?.role || "MEMBER";
      const isDefault = config.defaultTeamSlug === team.slug;

      console.log(`  ${team.name}${isDefault ? " (default)" : ""}`);
      console.log(`    Slug: ${team.slug}`);
      console.log(`    Role: ${role}`);
      console.log(`    Members: ${team.members.length}`);
      console.log(`    Sessions: ${team._count.sessions}`);
      console.log("");
    }

    // Quick actions menu
    console.log("");
    const choices = [
      { name: "Done", value: "done" },
      ...teams.map(t => ({
        name: `Set "${t.name}" as default`,
        value: `set:${t.slug}`,
      })),
      { name: "Open dashboard in browser", value: "dashboard" },
      { name: "Create new team", value: "create" },
    ];

    if (config.defaultTeamSlug) {
      choices.splice(1, 0, { name: "Clear default team", value: "unset" });
    }

    const action = await select({
      message: "Quick actions:",
      choices,
    });

    if (action === "done") {
      return;
    } else if (action === "unset") {
      delete config.defaultTeamSlug;
      saveConfig(config);
      console.log("Default team cleared.");
    } else if (action === "dashboard") {
      const url = "https://app.getpromptly.xyz/teams";
      console.log(`Opening ${url}...`);
      await open(url);
    } else if (action === "create") {
      const url = "https://app.getpromptly.xyz/teams/new";
      console.log(`Opening ${url}...`);
      await open(url);
    } else if (action.startsWith("set:")) {
      const slug = action.replace("set:", "");
      const team = teams.find(t => t.slug === slug);
      config.defaultTeamSlug = slug;
      saveConfig(config);
      console.log(`Default team set to: ${team?.name} (${slug})`);
    }
  } catch (err) {
    console.error(
      `Could not reach API at ${config.apiUrl}. Is it running?`
    );
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
