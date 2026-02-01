import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline/promises";

interface McpConfig {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
}

function findMcpConfigPath(): string | null {
  const candidates = [
    path.join(os.homedir(), ".claude", "claude_desktop_config.json"),
    path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    path.join(os.homedir(), ".config", "claude", "claude_desktop_config.json"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Default: create in ~/.claude/
  return path.join(os.homedir(), ".claude", "claude_desktop_config.json");
}

export async function initCommand() {
  console.log("Promptly MCP Setup\n");

  const configPath = findMcpConfigPath();
  if (!configPath) {
    console.error("Could not determine Claude Code config location.");
    process.exit(1);
  }

  console.log(`Config file: ${configPath}`);

  let config: McpConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as McpConfig;
    } catch {
      console.error(`Could not parse ${configPath}. Is it valid JSON?`);
      process.exit(1);
    }
  }

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  if (config.mcpServers.promptly) {
    console.log("\nPromptly MCP server is already configured.");
    console.log("Entry:", JSON.stringify(config.mcpServers.promptly, null, 2));
    return;
  }

  // Find the MCP server binary
  const mcpBin = findMcpBinary();

  console.log(`\nWill add the following MCP server entry:`);
  console.log(`  "promptly": { "command": "node", "args": ["${mcpBin}"] }\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Proceed? (Y/n) ");
  rl.close();

  if (answer && answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    console.log("Aborted.");
    return;
  }

  config.mcpServers.promptly = {
    command: "node",
    args: [mcpBin],
  };

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\nMCP server configured in ${configPath}`);
  console.log("Restart Claude Code to activate.");
}

function findMcpBinary(): string {
  // Check if installed globally
  const globalPaths = [
    path.join(os.homedir(), ".npm-global", "lib", "node_modules", "@promptly", "mcp-server", "dist", "index.js"),
    path.join("/usr", "local", "lib", "node_modules", "@promptly", "mcp-server", "dist", "index.js"),
  ];

  for (const p of globalPaths) {
    if (fs.existsSync(p)) return p;
  }

  // Check relative to this CLI (monorepo dev)
  const monorepoPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..", "..", "..", "mcp-server", "dist", "index.js"
  );
  if (fs.existsSync(monorepoPath)) return monorepoPath;

  // Fallback: assume npx can find it
  return "promptly-mcp";
}
