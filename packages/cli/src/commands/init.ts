import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline/promises";

interface Tool {
  name: string;
  detected: boolean;
  configured: boolean;
}

function findMcpBinary(): string {
  // Check common global install locations for @getpromptly/mcp-server
  const globalPaths = [
    path.join(os.homedir(), ".npm-global", "lib", "node_modules", "@getpromptly", "mcp-server", "dist", "index.js"),
    "/usr/local/lib/node_modules/@getpromptly/mcp-server/dist/index.js",
    "/opt/homebrew/lib/node_modules/@getpromptly/mcp-server/dist/index.js",
  ];

  for (const p of globalPaths) {
    if (fs.existsSync(p)) return p;
  }

  // Try npm root -g to find the actual global path
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
    const npmGlobalPath = path.join(globalRoot, "@getpromptly", "mcp-server", "dist", "index.js");
    if (fs.existsSync(npmGlobalPath)) return npmGlobalPath;
  } catch {
    // ignore
  }

  // Check relative to this CLI (monorepo dev)
  const monorepoPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..", "..", "..", "mcp-server", "dist", "index.js"
  );
  if (fs.existsSync(monorepoPath)) return monorepoPath;

  // Fallback: use npx
  return "";
}

function hasCommand(cmd: string): boolean {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// --- Claude Code ---

function isClaudeConfigured(): boolean {
  try {
    const list = execSync("claude mcp list", { encoding: "utf-8" });
    return list.includes("promptly");
  } catch {
    return false;
  }
}

function configureClaude(command: string, args: string[]): boolean {
  const serverJson = JSON.stringify({ command, args });
  try {
    execSync(`claude mcp add-json promptly '${serverJson}'`, { stdio: "inherit" });
    return true;
  } catch {
    // Fallback: write .mcp.json
    const mcpConfigPath = path.join(process.cwd(), ".mcp.json");
    let mcpConfig: Record<string, unknown> = {};
    if (fs.existsSync(mcpConfigPath)) {
      try {
        mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
      } catch {
        // start fresh
      }
    }
    mcpConfig.promptly = { command, args };
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    console.log(`  Wrote fallback config to ${mcpConfigPath}`);
    return true;
  }
}

// --- Gemini CLI ---

function isGeminiConfigured(): boolean {
  const settingsPath = path.join(os.homedir(), ".gemini", "settings.json");
  try {
    if (!fs.existsSync(settingsPath)) return false;
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return !!settings?.mcpServers?.promptly;
  } catch {
    return false;
  }
}

function configureGemini(command: string, args: string[]): boolean {
  const settingsPath = path.join(os.homedir(), ".gemini", "settings.json");
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      // start fresh
    }
  }

  if (!settings.mcpServers || typeof settings.mcpServers !== "object") {
    settings.mcpServers = {};
  }
  (settings.mcpServers as Record<string, unknown>).promptly = { command, args };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

// --- Codex CLI ---

function isCodexConfigured(): boolean {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  try {
    if (!fs.existsSync(configPath)) return false;
    const content = fs.readFileSync(configPath, "utf-8");
    return content.includes("[mcp_servers.promptly]");
  } catch {
    return false;
  }
}

function configureCodex(command: string, args: string[]): boolean {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let content = "";
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, "utf-8");
  }

  const argsToml = args.map(a => `"${a}"`).join(", ");
  const block = `\n[mcp_servers.promptly]\ncommand = "${command}"\nargs = [${argsToml}]\n`;

  content += block;
  fs.writeFileSync(configPath, content);
  return true;
}

// --- Main ---

export async function initCommand() {
  console.log("Promptly MCP Setup\n");

  const mcpBin = findMcpBinary();

  let command: string;
  let args: string[];

  if (mcpBin) {
    command = "node";
    args = [mcpBin];
    console.log(`Found MCP server at: ${mcpBin}`);
  } else {
    command = "npx";
    args = ["-y", "@getpromptly/mcp-server"];
    console.log("MCP server not found locally, will use npx.");
  }

  // Detect tools
  const tools: Tool[] = [
    { name: "Claude Code", detected: hasCommand("claude"), configured: false },
    { name: "Gemini CLI", detected: hasCommand("gemini"), configured: false },
    { name: "Codex CLI", detected: hasCommand("codex"), configured: false },
  ];

  // Check which are already configured
  if (tools[0].detected) tools[0].configured = isClaudeConfigured();
  if (tools[1].detected) tools[1].configured = isGeminiConfigured();
  if (tools[2].detected) tools[2].configured = isCodexConfigured();

  // Report detection
  console.log("\nDetected AI coding tools:");
  for (const tool of tools) {
    const status = !tool.detected
      ? "not found"
      : tool.configured
        ? "already configured"
        : "found";
    console.log(`  ${tool.name}: ${status}`);
  }

  const toConfigure = tools.filter(t => t.detected && !t.configured);

  if (toConfigure.length === 0) {
    if (tools.every(t => !t.detected)) {
      console.log("\nNo supported AI coding tools detected.");
      console.log("Install Claude Code, Gemini CLI, or Codex CLI and run this again.");
    } else {
      console.log("\nAll detected tools are already configured.");
    }
    return;
  }

  console.log(`\nWill configure: ${toConfigure.map(t => t.name).join(", ")}`);
  console.log(`Server: ${command} ${args.join(" ")}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Proceed? (Y/n) ");
  rl.close();

  if (answer && answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    console.log("Aborted.");
    return;
  }

  // Configure each tool
  for (const tool of toConfigure) {
    process.stdout.write(`\nConfiguring ${tool.name}... `);
    let ok = false;

    if (tool.name === "Claude Code") ok = configureClaude(command, args);
    else if (tool.name === "Gemini CLI") ok = configureGemini(command, args);
    else if (tool.name === "Codex CLI") ok = configureCodex(command, args);

    console.log(ok ? "done." : "failed.");
  }

  console.log("\nSetup complete. Restart your AI coding tool to activate Promptly.");
}
