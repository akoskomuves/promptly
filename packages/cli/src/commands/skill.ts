import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { confirm } from "@inquirer/prompts";

const TRACK_SKILL_CONTENT = `---
name: track
description: Start, check, or finish tracking an AI session with Promptly. Use this to tie your work to a ticket ID and track token usage.
allowed-tools: mcp__promptly__promptly_start, mcp__promptly__promptly_status, mcp__promptly__promptly_finish
argument-hint: "<ticket-id> | status | finish"
---

# Promptly Session Tracker

Track your AI coding sessions to measure token usage and tie work to tickets.

## Usage

- \`/track <ticket-id>\` — Start tracking (e.g., \`/track AUTH-123\`, \`/track feature-login\`)
- \`/track status\` — Check current tracking status
- \`/track finish\` — End session and save to dashboard

## How It Works

When you run \`/track <ticket-id>\`:
1. Call the \`promptly_start\` MCP tool with the ticket ID
2. All conversation turns are automatically logged
3. When done, run \`/track finish\` to save the session

## Examples

Start tracking a feature:
\`\`\`
/track FEAT-456
\`\`\`

Check if tracking is active:
\`\`\`
/track status
\`\`\`

Finish and save the session:
\`\`\`
/track finish
\`\`\`

## Behavior

Based on the argument:
- If argument is "status" → call \`promptly_status\` tool
- If argument is "finish" → call \`promptly_finish\` tool
- Otherwise → call \`promptly_start\` with the argument as ticketId
`;

export function isClaudeInstalled(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isClaudeConfigured(): boolean {
  try {
    const list = execSync("claude mcp list", { encoding: "utf-8" });
    return list.includes("promptly");
  } catch {
    return false;
  }
}

export function isSkillInstalled(location: "project" | "global"): boolean {
  const skillPath = location === "project"
    ? path.join(process.cwd(), ".claude", "skills", "track", "SKILL.md")
    : path.join(os.homedir(), ".claude", "skills", "track", "SKILL.md");
  return fs.existsSync(skillPath);
}

export function isSkillInstalledAnywhere(): boolean {
  return isSkillInstalled("project") || isSkillInstalled("global");
}

export function installSkill(location: "project" | "global"): boolean {
  const skillDir = location === "project"
    ? path.join(process.cwd(), ".claude", "skills", "track")
    : path.join(os.homedir(), ".claude", "skills", "track");

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), TRACK_SKILL_CONTENT);
    return true;
  } catch {
    return false;
  }
}

export async function skillCommand(action?: string) {
  if (action === "install") {
    await installSkillInteractive();
  } else if (action === "uninstall") {
    await uninstallSkillInteractive();
  } else if (action === "status") {
    showSkillStatus();
  } else {
    // Default: show status and help
    showSkillStatus();
    console.log("\nCommands:");
    console.log("  promptly skill install    Install /track skill for Claude Code");
    console.log("  promptly skill uninstall  Remove /track skill");
    console.log("  promptly skill status     Show installation status");
  }
}

async function installSkillInteractive() {
  if (!isClaudeInstalled()) {
    console.log("Claude Code is not installed. The /track skill is only for Claude Code.");
    return;
  }

  if (!isClaudeConfigured()) {
    console.log("Promptly MCP server is not configured for Claude Code.");
    console.log("Run 'promptly init' first to configure the MCP server.");
    return;
  }

  const projectInstalled = isSkillInstalled("project");
  const globalInstalled = isSkillInstalled("global");

  if (projectInstalled || globalInstalled) {
    const location = projectInstalled ? "project (.claude/skills/track/)" : "global (~/.claude/skills/track/)";
    console.log(`/track skill is already installed (${location}).`);

    const reinstall = await confirm({
      message: "Reinstall/update the skill?",
      default: false,
    });

    if (!reinstall) return;
  }

  const installGlobal = await confirm({
    message: "Install globally (~/.claude/skills/) for all projects?",
    default: false,
  });

  const location = installGlobal ? "global" : "project";
  process.stdout.write(`Installing /track skill (${location})... `);
  const ok = installSkill(location);
  console.log(ok ? "done." : "failed.");

  if (ok) {
    console.log("\nYou can now use these commands in Claude Code:");
    console.log("  /track <ticket-id>  — Start tracking a session");
    console.log("  /track status       — Check tracking status");
    console.log("  /track finish       — End and save session");
    console.log("\nRestart Claude Code to activate the skill.");
  }
}

async function uninstallSkillInteractive() {
  const projectInstalled = isSkillInstalled("project");
  const globalInstalled = isSkillInstalled("global");

  if (!projectInstalled && !globalInstalled) {
    console.log("/track skill is not installed.");
    return;
  }

  if (projectInstalled) {
    const skillPath = path.join(process.cwd(), ".claude", "skills", "track");
    const doRemove = await confirm({
      message: `Remove project skill at ${skillPath}?`,
      default: true,
    });
    if (doRemove) {
      fs.rmSync(skillPath, { recursive: true, force: true });
      console.log("Removed project skill.");
    }
  }

  if (globalInstalled) {
    const skillPath = path.join(os.homedir(), ".claude", "skills", "track");
    const doRemove = await confirm({
      message: `Remove global skill at ${skillPath}?`,
      default: true,
    });
    if (doRemove) {
      fs.rmSync(skillPath, { recursive: true, force: true });
      console.log("Removed global skill.");
    }
  }
}

function showSkillStatus() {
  console.log("Claude Code /track Skill Status\n");

  const claudeInstalled = isClaudeInstalled();
  const claudeConfigured = claudeInstalled && isClaudeConfigured();
  const projectInstalled = isSkillInstalled("project");
  const globalInstalled = isSkillInstalled("global");

  console.log(`  Claude Code installed:  ${claudeInstalled ? "yes" : "no"}`);
  console.log(`  Promptly MCP configured: ${claudeConfigured ? "yes" : "no"}`);
  console.log(`  /track skill (project): ${projectInstalled ? "installed" : "not installed"}`);
  console.log(`  /track skill (global):  ${globalInstalled ? "installed" : "not installed"}`);
}
