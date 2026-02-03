import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkbox, confirm } from "@inquirer/prompts";

interface Tool {
  name: string;
  detected: boolean;
  configured: boolean;
}

function findMcpBinary(): string {
  const globalPaths = [
    path.join(os.homedir(), ".npm-global", "lib", "node_modules", "@getpromptly", "mcp-server", "dist", "index.js"),
    "/usr/local/lib/node_modules/@getpromptly/mcp-server/dist/index.js",
    "/opt/homebrew/lib/node_modules/@getpromptly/mcp-server/dist/index.js",
  ];

  for (const p of globalPaths) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
    const npmGlobalPath = path.join(globalRoot, "@getpromptly", "mcp-server", "dist", "index.js");
    if (fs.existsSync(npmGlobalPath)) return npmGlobalPath;
  } catch {
    // ignore
  }

  const monorepoPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..", "..", "..", "mcp-server", "dist", "index.js"
  );
  if (fs.existsSync(monorepoPath)) return monorepoPath;

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

// --- Generic JSON mcpServers config (Gemini, Cursor, Windsurf, VS Code) ---

function isJsonMcpConfigured(configPath: string): boolean {
  try {
    if (!fs.existsSync(configPath)) return false;
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return !!config?.mcpServers?.promptly;
  } catch {
    return false;
  }
}

function configureJsonMcp(configPath: string, command: string, args: string[]): boolean {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let config: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      // start fresh
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  (config.mcpServers as Record<string, unknown>).promptly = { command, args };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return true;
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

// --- Codex CLI (TOML) ---

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

// --- Detection for IDE-based tools (config file existence) ---

function hasConfigDir(dirPath: string): boolean {
  return fs.existsSync(dirPath);
}

// --- Tool definitions ---

interface ToolDef {
  name: string;
  detect: () => boolean;
  isConfigured: (cmd: string, args: string[]) => boolean;
  configure: (cmd: string, args: string[]) => boolean;
}

function getToolDefs(): ToolDef[] {
  const home = os.homedir();

  return [
    // CLI tools (detected by command)
    {
      name: "Claude Code",
      detect: () => hasCommand("claude"),
      isConfigured: () => isClaudeConfigured(),
      configure: (cmd, args) => configureClaude(cmd, args),
    },
    {
      name: "Gemini CLI",
      detect: () => hasCommand("gemini"),
      isConfigured: () => isJsonMcpConfigured(path.join(home, ".gemini", "settings.json")),
      configure: (cmd, args) => configureJsonMcp(path.join(home, ".gemini", "settings.json"), cmd, args),
    },
    {
      name: "Codex CLI",
      detect: () => hasCommand("codex"),
      isConfigured: () => isCodexConfigured(),
      configure: (cmd, args) => configureCodex(cmd, args),
    },
    // IDE tools (detected by config directory existence)
    {
      name: "Cursor",
      detect: () => hasConfigDir(path.join(home, ".cursor")),
      isConfigured: () => isJsonMcpConfigured(path.join(home, ".cursor", "mcp.json")),
      configure: (cmd, args) => configureJsonMcp(path.join(home, ".cursor", "mcp.json"), cmd, args),
    },
    {
      name: "Windsurf",
      detect: () => hasConfigDir(path.join(home, ".codeium", "windsurf")),
      isConfigured: () => isJsonMcpConfigured(path.join(home, ".codeium", "windsurf", "mcp_config.json")),
      configure: (cmd, args) => configureJsonMcp(path.join(home, ".codeium", "windsurf", "mcp_config.json"), cmd, args),
    },
    {
      name: "VS Code (Copilot)",
      detect: () => hasCommand("code"),
      isConfigured: () => isJsonMcpConfigured(path.join(home, ".vscode", "mcp.json")),
      configure: (cmd, args) => configureJsonMcp(path.join(home, ".vscode", "mcp.json"), cmd, args),
    },
  ];
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
  const toolDefs = getToolDefs();
  const tools: Tool[] = toolDefs.map(def => ({
    name: def.name,
    detected: def.detect(),
    configured: false,
  }));

  // Check which are already configured
  for (let i = 0; i < tools.length; i++) {
    if (tools[i].detected) {
      tools[i].configured = toolDefs[i].isConfigured(command, args);
    }
  }

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

  const availableToConfigure = tools.filter(t => t.detected && !t.configured);

  if (availableToConfigure.length === 0) {
    if (tools.every(t => !t.detected)) {
      console.log("\nNo supported AI coding tools detected.");
      console.log("Supported: Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf, VS Code.");
    } else {
      console.log("\nAll detected tools are already configured.");
    }
    return;
  }

  console.log(`\nServer: ${command} ${args.join(" ")}\n`);

  // Let user select which tools to configure
  const selectedTools = await checkbox({
    message: "Select tools to configure:",
    choices: availableToConfigure.map(t => ({
      name: t.name,
      value: t.name,
      checked: true, // Pre-select all by default
    })),
  });

  if (selectedTools.length === 0) {
    console.log("No tools selected. Aborted.");
    return;
  }

  const toConfigure = availableToConfigure.filter(t => selectedTools.includes(t.name));

  // Configure each selected tool
  for (const tool of toConfigure) {
    process.stdout.write(`\nConfiguring ${tool.name}... `);
    const def = toolDefs.find(d => d.name === tool.name)!;
    const ok = def.configure(command, args);
    console.log(ok ? "done." : "failed.");
  }

  console.log("\nSetup complete. Restart your AI coding tools to activate Promptly.");
}
