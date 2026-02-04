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

const program = new Command();

program
  .name("promptly")
  .description("Developer prompt analytics - log and review AI conversations")
  .version("0.1.0");

program
  .command("login")
  .description("Authenticate with Promptly")
  .option("--api-url <url>", "API server URL")
  .action(loginCommand);

program
  .command("start [ticket-id]")
  .description("Start logging AI conversations for a ticket")
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
  .action(skillCommand);

program.parse();
