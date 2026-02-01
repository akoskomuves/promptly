#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { startCommand } from "./commands/start.js";
import { finishCommand } from "./commands/finish.js";
import { statusCommand } from "./commands/status.js";
import { serveCommand } from "./commands/serve.js";
import { initCommand } from "./commands/init.js";

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
  .command("start <ticket-id>")
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
  .description("Auto-detect and configure MCP in Claude Code, Gemini CLI, Codex CLI")
  .action(initCommand);

program.parse();
