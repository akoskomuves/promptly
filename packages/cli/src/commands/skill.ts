import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { confirm } from "@inquirer/prompts";
import { installAutoPromptInteractive, getAutoPromptStatus } from "./autoprompt.js";

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

// --- Codex CLI Skill Content ---

const CODEX_SKILL_CONTENT = `---
name: track
description: Start, check, or finish tracking an AI session with Promptly. Use this to tie your work to a ticket ID and track token usage.
---

# Promptly Session Tracker

Track your AI coding sessions to measure token usage and tie work to tickets.

## Usage

- \`$track <ticket-id>\` — Start tracking (e.g., \`$track AUTH-123\`)
- \`$track status\` — Check current tracking status
- \`$track finish\` — End session and save to dashboard

## How It Works

When you run \`$track <ticket-id>\`:
1. Call the \`promptly_start\` MCP tool with the ticket ID
2. All conversation turns are automatically logged
3. When done, run \`$track finish\` to save the session

## Behavior

Based on the argument:
- If argument is "status" → call \`promptly_status\` MCP tool
- If argument is "finish" → call \`promptly_finish\` MCP tool
- Otherwise → call \`promptly_start\` MCP tool with the argument as ticketId
`;

const CODEX_AGENTS_YAML = `# MCP tool dependencies for Promptly tracking
dependencies:
  tools:
    - type: "mcp"
      value: "promptly_start"
      description: "Start tracking an AI session with a ticket ID"
    - type: "mcp"
      value: "promptly_status"
      description: "Check current session tracking status"
    - type: "mcp"
      value: "promptly_finish"
      description: "Finish and save the current tracking session"
`;

// --- Gemini CLI Command Content ---

const GEMINI_COMMAND_CONTENT = `# Promptly session tracking command
description = "Start, check, or finish tracking an AI session with Promptly"
prompt = """Based on the argument provided:

If the argument is "status":
- Call the promptly_status MCP tool to check the current tracking status

If the argument is "finish":
- Call the promptly_finish MCP tool to end and save the session

Otherwise (a ticket ID like "AUTH-123"):
- Call the promptly_start MCP tool with the argument as the ticketId

Report the result to the user.

Argument: {{args}}
"""
`;

// --- VS Code + Copilot Prompt Content ---

const VSCODE_PROMPT_CONTENT = `---
name: "Track Session"
description: "Start, check, or finish tracking an AI session with Promptly"
tools: ['promptly']
---

# Promptly Session Tracker

Based on the user's request, perform one of these actions:

## Start Tracking
If given a ticket ID (like "AUTH-123" or "feature-login"):
- Call the \`promptly_start\` tool with the ticket ID
- Confirm the session has started

## Check Status
If asked for "status":
- Call the \`promptly_status\` tool
- Report the current tracking status

## Finish Session
If asked to "finish":
- Call the \`promptly_finish\` tool
- Confirm the session has been saved

Usage examples:
- "/track AUTH-123" → Start tracking
- "/track status" → Check status
- "/track finish" → End session
`;

// --- Tool Detection ---

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

export function isCodexInstalled(): boolean {
  try {
    execSync("codex --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isCodexConfigured(): boolean {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  try {
    if (!fs.existsSync(configPath)) return false;
    const content = fs.readFileSync(configPath, "utf-8");
    return content.includes("[mcp_servers.promptly]");
  } catch {
    return false;
  }
}

export function isGeminiInstalled(): boolean {
  try {
    execSync("gemini --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isGeminiConfigured(): boolean {
  const configPath = path.join(os.homedir(), ".gemini", "settings.json");
  try {
    if (!fs.existsSync(configPath)) return false;
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return !!config?.mcpServers?.promptly;
  } catch {
    return false;
  }
}

export function isVSCodeInstalled(): boolean {
  try {
    execSync("code --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isVSCodeConfigured(): boolean {
  const configPath = path.join(os.homedir(), ".vscode", "mcp.json");
  try {
    if (!fs.existsSync(configPath)) return false;
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return !!config?.mcpServers?.promptly;
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

// --- Codex CLI Skill Functions ---

export function isCodexSkillInstalled(location: "project" | "global"): boolean {
  const skillPath = location === "project"
    ? path.join(process.cwd(), ".codex", "skills", "track", "SKILL.md")
    : path.join(os.homedir(), ".codex", "skills", "track", "SKILL.md");
  return fs.existsSync(skillPath);
}

export function isCodexSkillInstalledAnywhere(): boolean {
  return isCodexSkillInstalled("project") || isCodexSkillInstalled("global");
}

export function installCodexSkill(location: "project" | "global"): boolean {
  const skillDir = location === "project"
    ? path.join(process.cwd(), ".codex", "skills", "track")
    : path.join(os.homedir(), ".codex", "skills", "track");

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), CODEX_SKILL_CONTENT);

    // Also create agents/openai.yaml for MCP tool dependencies
    const agentsDir = path.join(skillDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "openai.yaml"), CODEX_AGENTS_YAML);

    return true;
  } catch {
    return false;
  }
}

// --- Gemini CLI Command Functions ---

export function isGeminiCommandInstalled(location: "project" | "global"): boolean {
  const cmdPath = location === "project"
    ? path.join(process.cwd(), ".gemini", "commands", "track.toml")
    : path.join(os.homedir(), ".gemini", "commands", "track.toml");
  return fs.existsSync(cmdPath);
}

export function isGeminiCommandInstalledAnywhere(): boolean {
  return isGeminiCommandInstalled("project") || isGeminiCommandInstalled("global");
}

export function installGeminiCommand(location: "project" | "global"): boolean {
  const cmdDir = location === "project"
    ? path.join(process.cwd(), ".gemini", "commands")
    : path.join(os.homedir(), ".gemini", "commands");

  try {
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, "track.toml"), GEMINI_COMMAND_CONTENT);
    return true;
  } catch {
    return false;
  }
}

// --- VS Code + Copilot Prompt Functions ---

export function isVSCodePromptInstalled(): boolean {
  // VS Code prompts are project-only at .github/prompts/
  const promptPath = path.join(process.cwd(), ".github", "prompts", "track.prompt.md");
  return fs.existsSync(promptPath);
}

export function installVSCodePrompt(): boolean {
  const promptDir = path.join(process.cwd(), ".github", "prompts");

  try {
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(path.join(promptDir, "track.prompt.md"), VSCODE_PROMPT_CONTENT);
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
  let installedAny = false;

  // Claude Code
  if (isClaudeInstalled() && isClaudeConfigured()) {
    const projectInstalled = isSkillInstalled("project");
    const globalInstalled = isSkillInstalled("global");

    if (projectInstalled || globalInstalled) {
      const location = projectInstalled ? "project" : "global";
      console.log(`Claude Code: /track skill already installed (${location}).`);
    } else {
      const install = await confirm({
        message: "Install /track skill for Claude Code?",
        default: true,
      });

      if (install) {
        const installGlobal = await confirm({
          message: "Install globally (~/.claude/skills/) for all projects?",
          default: false,
        });

        const location = installGlobal ? "global" : "project";
        process.stdout.write(`Installing Claude Code skill (${location})... `);
        const ok = installSkill(location);
        console.log(ok ? "done." : "failed.");
        if (ok) installedAny = true;
      }
    }
  } else if (isClaudeInstalled()) {
    console.log("Claude Code: MCP not configured. Run 'promptly init' first.");
  }

  // Codex CLI
  if (isCodexInstalled() && isCodexConfigured()) {
    const projectInstalled = isCodexSkillInstalled("project");
    const globalInstalled = isCodexSkillInstalled("global");

    if (projectInstalled || globalInstalled) {
      const location = projectInstalled ? "project" : "global";
      console.log(`Codex CLI: $track skill already installed (${location}).`);
    } else {
      const install = await confirm({
        message: "Install $track skill for Codex CLI?",
        default: true,
      });

      if (install) {
        const installGlobal = await confirm({
          message: "Install globally (~/.codex/skills/) for all projects?",
          default: false,
        });

        const location = installGlobal ? "global" : "project";
        process.stdout.write(`Installing Codex CLI skill (${location})... `);
        const ok = installCodexSkill(location);
        console.log(ok ? "done." : "failed.");
        if (ok) installedAny = true;
      }
    }
  } else if (isCodexInstalled()) {
    console.log("Codex CLI: MCP not configured. Run 'promptly init' first.");
  }

  // Gemini CLI
  if (isGeminiInstalled() && isGeminiConfigured()) {
    const projectInstalled = isGeminiCommandInstalled("project");
    const globalInstalled = isGeminiCommandInstalled("global");

    if (projectInstalled || globalInstalled) {
      const location = projectInstalled ? "project" : "global";
      console.log(`Gemini CLI: /track command already installed (${location}).`);
    } else {
      const install = await confirm({
        message: "Install /track command for Gemini CLI?",
        default: true,
      });

      if (install) {
        const installGlobal = await confirm({
          message: "Install globally (~/.gemini/commands/) for all projects?",
          default: false,
        });

        const location = installGlobal ? "global" : "project";
        process.stdout.write(`Installing Gemini CLI command (${location})... `);
        const ok = installGeminiCommand(location);
        console.log(ok ? "done." : "failed.");
        if (ok) installedAny = true;
      }
    }
  } else if (isGeminiInstalled()) {
    console.log("Gemini CLI: MCP not configured. Run 'promptly init' first.");
  }

  // VS Code + Copilot
  if (isVSCodeInstalled() && isVSCodeConfigured()) {
    if (isVSCodePromptInstalled()) {
      console.log("VS Code + Copilot: /track prompt already installed.");
    } else {
      const install = await confirm({
        message: "Install /track prompt for VS Code + Copilot?",
        default: true,
      });

      if (install) {
        process.stdout.write("Installing VS Code prompt (.github/prompts/)... ");
        const ok = installVSCodePrompt();
        console.log(ok ? "done." : "failed.");
        if (ok) installedAny = true;
      }
    }
  } else if (isVSCodeInstalled()) {
    console.log("VS Code + Copilot: MCP not configured. Run 'promptly init' first.");
  }

  // No tools found
  if (!isClaudeInstalled() && !isCodexInstalled() && !isGeminiInstalled() && !isVSCodeInstalled()) {
    console.log("No supported AI coding tools found.");
    console.log("Supported: Claude Code, Codex CLI, Gemini CLI, VS Code + Copilot");
    return;
  }

  if (installedAny) {
    console.log("\nUsage:");
    console.log("  Claude Code:       /track <ticket-id>, /track status, /track finish");
    console.log("  Codex CLI:         $track <ticket-id>, $track status, $track finish");
    console.log("  Gemini CLI:        /track <ticket-id>, /track status, /track finish");
    console.log("  VS Code + Copilot: /track <ticket-id>, /track status, /track finish");
    console.log("\nRestart your AI tool to activate.");
  }

  // Offer auto-prompt for all configured tools
  const claudeConfigured = isClaudeInstalled() && isClaudeConfigured();
  const codexConfigured = isCodexInstalled() && isCodexConfigured();
  const geminiConfigured = isGeminiInstalled() && isGeminiConfigured();
  const vscodeConfigured = isVSCodeInstalled() && isVSCodeConfigured();

  await installAutoPromptInteractive({
    claude: claudeConfigured,
    codex: codexConfigured,
    gemini: geminiConfigured,
    vscode: vscodeConfigured,
  });
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
  console.log("Promptly /track Skill Status\n");

  // Claude Code
  const claudeInstalled = isClaudeInstalled();
  const claudeConfigured = claudeInstalled && isClaudeConfigured();
  const claudeProjectSkill = isSkillInstalled("project");
  const claudeGlobalSkill = isSkillInstalled("global");

  console.log("Claude Code:");
  console.log(`  Installed:       ${claudeInstalled ? "yes" : "no"}`);
  console.log(`  MCP configured:  ${claudeConfigured ? "yes" : "no"}`);
  console.log(`  Skill (project): ${claudeProjectSkill ? "installed" : "not installed"}`);
  console.log(`  Skill (global):  ${claudeGlobalSkill ? "installed" : "not installed"}`);

  // Codex CLI
  const codexInstalled = isCodexInstalled();
  const codexConfigured = codexInstalled && isCodexConfigured();
  const codexProjectSkill = isCodexSkillInstalled("project");
  const codexGlobalSkill = isCodexSkillInstalled("global");

  console.log("\nCodex CLI:");
  console.log(`  Installed:       ${codexInstalled ? "yes" : "no"}`);
  console.log(`  MCP configured:  ${codexConfigured ? "yes" : "no"}`);
  console.log(`  Skill (project): ${codexProjectSkill ? "installed" : "not installed"}`);
  console.log(`  Skill (global):  ${codexGlobalSkill ? "installed" : "not installed"}`);

  // Gemini CLI
  const geminiInstalled = isGeminiInstalled();
  const geminiConfigured = geminiInstalled && isGeminiConfigured();
  const geminiProjectCmd = isGeminiCommandInstalled("project");
  const geminiGlobalCmd = isGeminiCommandInstalled("global");

  console.log("\nGemini CLI:");
  console.log(`  Installed:         ${geminiInstalled ? "yes" : "no"}`);
  console.log(`  MCP configured:    ${geminiConfigured ? "yes" : "no"}`);
  console.log(`  Command (project): ${geminiProjectCmd ? "installed" : "not installed"}`);
  console.log(`  Command (global):  ${geminiGlobalCmd ? "installed" : "not installed"}`);

  // VS Code + Copilot
  const vscodeInstalled = isVSCodeInstalled();
  const vscodeConfigured = vscodeInstalled && isVSCodeConfigured();
  const vscodePrompt = isVSCodePromptInstalled();

  console.log("\nVS Code + Copilot:");
  console.log(`  Installed:         ${vscodeInstalled ? "yes" : "no"}`);
  console.log(`  MCP configured:    ${vscodeConfigured ? "yes" : "no"}`);
  console.log(`  Prompt (project):  ${vscodePrompt ? "installed" : "not installed"}`);

  // Auto-prompt status
  console.log("\nAuto-prompt:");
  const toolStatuses = [
    getAutoPromptStatus("claude", "Claude Code"),
    getAutoPromptStatus("codex", "Codex CLI"),
    getAutoPromptStatus("gemini", "Gemini CLI"),
    getAutoPromptStatus("vscode", "VS Code + Copilot"),
    getAutoPromptStatus("cursor", "Cursor"),
    getAutoPromptStatus("windsurf", "Windsurf"),
  ];

  for (const status of toolStatuses) {
    const parts: string[] = [];
    if (status.projectEnabled && status.projectPath) {
      const rel = path.relative(process.cwd(), status.projectPath);
      parts.push(`project (${rel})`);
    }
    if (status.globalEnabled && status.globalPath) {
      const abbrev = status.globalPath.replace(os.homedir(), "~");
      parts.push(`global (${abbrev})`);
    }
    const label = parts.length > 0 ? `enabled — ${parts.join(", ")}` : "not enabled";
    console.log(`  ${status.label.padEnd(20)} ${label}`);
  }
}
