#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { startCommand } from "./commands/start.js";
import { finishCommand } from "./commands/finish.js";
import { statusCommand } from "./commands/status.js";
import { serveCommand } from "./commands/serve.js";
import { initCommand } from "./commands/init.js";
import { reportCommand } from "./commands/report.js";
import { teamsCommand } from "./commands/teams.js";
import { teamCommand } from "./commands/team.js";
import { skillCommand } from "./commands/skill.js";
import { digestCommand } from "./commands/digest.js";
import { importClaudeCommand } from "./commands/import-claude.js";
import { optimizeCommand } from "./commands/optimize.js";
import { reviewCommand } from "./commands/review.js";
import { telemetryCommand } from "./commands/telemetry.js";
import { statuslineCommand } from "./commands/statusline.js";

const program = new Command();

program
  .name("promptly")
  .description("Developer prompt analytics - log and review AI conversations")
  .version("0.2.5");

program
  .command("login")
  .description("Authenticate with Promptly")
  .option("--api-url <url>", "API server URL")
  .action(loginCommand);

program
  .command("start [ticket-id]")
  .description("Start logging AI conversations (ticket ID optional)")
  .action(startCommand);

program
  .command("finish")
  .description("Finish the current session and upload")
  .action(finishCommand);

program
  .command("status")
  .description("Show current session status")
  .action(statusCommand);

program
  .command("serve")
  .description("Start the local dashboard server")
  .option("-p, --port <port>", "Port number", "3000")
  .action(serveCommand);

program
  .command("init")
  .description("Auto-detect and configure MCP in all supported AI coding tools")
  .option("--tools <tools>", "Comma-separated tools to configure (claude, codex, gemini, vscode, cursor, windsurf) — skips the selector")
  .option("-y, --yes", "Accept defaults for all prompts (for scripts and AI agents)")
  .action(initCommand);

program
  .command("report")
  .description("Show summary stats for a time period")
  .option("--from <date>", "Start date (YYYY-MM-DD)")
  .option("--to <date>", "End date (YYYY-MM-DD)")
  .option("--period <period>", "Preset period: today, week, month, year")
  .action(reportCommand);

program
  .command("teams")
  .description("List your teams (cloud mode)")
  .action(teamsCommand);

program
  .command("team [action] [slug]")
  .description("Manage default team: set <slug> | unset")
  .action(teamCommand);

program
  .command("skill [action]")
  .description("Manage Claude Code /track skill: install | uninstall | status")
  .option("-y, --yes", "Accept defaults for all prompts (for scripts and AI agents)")
  .action(skillCommand);

program
  .command("digest")
  .description("Weekly insights digest — session summary with trends")
  .option("--from <date>", "Start of current period (YYYY-MM-DD)")
  .option("--to <date>", "End of current period (YYYY-MM-DD)")
  .action(digestCommand);

program
  .command("import-claude")
  .description("Import a past Claude Code session from ~/.claude/projects (no MCP setup needed)")
  .option("--session <id>", "Claude session ID (or prefix) to import non-interactively")
  .option("--ticket <id>", "Ticket ID to tag the imported session with")
  .option("--list", "List recent Claude Code sessions and exit")
  .action(importClaudeCommand);

program
  .command("optimize")
  .description("Analyze session history and surface AI spend leak recommendations")
  .option("--days <n>", "Lookback window in days (default 90)")
  .option("--from <date>", "Start date (YYYY-MM-DD) — overrides --days")
  .option("--to <date>", "End date (YYYY-MM-DD)")
  .option("--json", "Print recommendations as JSON")
  .action(optimizeCommand);

program
  .command("review <session-id>")
  .description("Run prompt review against a captured session (LLM-as-judge)")
  .option("--rubric <id>", "Rubric to apply (default: intent-clarity)")
  .option("--model <id>", "Override the judge model (default: rubric's model_default)")
  .option("--json", "Print verdict as JSON")
  .action(reviewCommand);

program
  .command("telemetry [action]")
  .description("Manage anonymous usage telemetry: on | off | status")
  .action(telemetryCommand);

program
  .command("statusline [action]")
  .description("Recording indicator for your AI tool's status line: (print) | install | uninstall")
  .action(statuslineCommand);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
