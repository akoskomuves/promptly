import { loadConfig, isLocalMode } from "../config.js";

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

    if (!config.defaultTeamSlug) {
      console.log("Tip: Run 'promptly team set <slug>' to set a default team.");
    }
  } catch (err) {
    console.error(
      `Could not reach API at ${config.apiUrl}. Is it running?`
    );
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
