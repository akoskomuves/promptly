import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { confirm } from "@inquirer/prompts";

// --- Instruction block constants ---

const AUTO_PROMPT_MCP = `
<!-- promptly:auto-prompt:start -->
## Promptly Session Tracking
At the start of each conversation, call the \`promptly_status\` MCP tool to check if a session is being tracked. If no session is active, ask: "Want me to track this session? Provide a ticket ID (e.g. AUTH-123)." If the user provides one, call \`promptly_start\` with it. If they decline, continue without asking again.
<!-- promptly:auto-prompt:end -->`;

const AUTO_PROMPT_MANUAL = `
# promptly:auto-prompt:start
# Promptly: At conversation start, suggest: "Track this session? Run: promptly start <ticket-id>"
# promptly:auto-prompt:end`;

const MARKER_START_MD = "<!-- promptly:auto-prompt:start -->";
const MARKER_END_MD = "<!-- promptly:auto-prompt:end -->";
const MARKER_START_COMMENT = "# promptly:auto-prompt:start";
const MARKER_END_COMMENT = "# promptly:auto-prompt:end";

// --- Tool instruction file paths ---

type ToolFormat = "markdown" | "comment";

interface InstructionPathConfig {
  project: string | ((cwd: string) => string);
  global?: string;
  format: ToolFormat;
}

const TOOL_INSTRUCTION_PATHS: Record<string, InstructionPathConfig> = {
  claude: {
    project: (cwd: string) => {
      // Prefer root CLAUDE.md if it exists, else .claude/CLAUDE.md
      const rootPath = path.join(cwd, "CLAUDE.md");
      if (fs.existsSync(rootPath)) return rootPath;
      const dotPath = path.join(cwd, ".claude", "CLAUDE.md");
      if (fs.existsSync(dotPath)) return dotPath;
      // Create in .claude/CLAUDE.md (don't create root — that's project-specific)
      return dotPath;
    },
    global: path.join(os.homedir(), ".claude", "CLAUDE.md"),
    format: "markdown",
  },
  codex: {
    project: (cwd: string) => path.join(cwd, ".codex", "instructions.md"),
    global: path.join(os.homedir(), ".codex", "instructions.md"),
    format: "markdown",
  },
  gemini: {
    project: (cwd: string) => path.join(cwd, "GEMINI.md"),
    global: path.join(os.homedir(), ".gemini", "GEMINI.md"),
    format: "markdown",
  },
  vscode: {
    project: (cwd: string) => path.join(cwd, ".github", "copilot-instructions.md"),
    format: "markdown",
  },
  cursor: {
    project: (cwd: string) => path.join(cwd, ".cursorrules"),
    format: "comment",
  },
  windsurf: {
    project: (cwd: string) => path.join(cwd, ".windsurfrules"),
    format: "comment",
  },
};

// --- Core functions ---

export function getInstructionFilePath(tool: string, location: "project" | "global"): string | null {
  const config = TOOL_INSTRUCTION_PATHS[tool];
  if (!config) return null;

  if (location === "global") {
    return config.global ?? null;
  }

  const projectPath = config.project;
  if (typeof projectPath === "function") {
    return projectPath(process.cwd());
  }
  return projectPath;
}

export function hasAutoPrompt(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, "utf-8");
    return content.includes("promptly:auto-prompt:start");
  } catch {
    return false;
  }
}

export function installAutoPrompt(tool: string, location: "project" | "global"): { ok: boolean; filePath: string | null } {
  const filePath = getInstructionFilePath(tool, location);
  if (!filePath) return { ok: false, filePath: null };

  const config = TOOL_INSTRUCTION_PATHS[tool];
  const block = config.format === "markdown" ? AUTO_PROMPT_MCP : AUTO_PROMPT_MANUAL;

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, "utf-8");

      // Already has auto-prompt — update it
      if (content.includes("promptly:auto-prompt:start")) {
        content = replaceBlock(content, config.format, block);
        fs.writeFileSync(filePath, content);
        return { ok: true, filePath };
      }

      // Append block
      const separator = content.endsWith("\n") ? "" : "\n";
      fs.writeFileSync(filePath, content + separator + block + "\n");
    } else {
      // Create new file with just the block
      fs.writeFileSync(filePath, block.trimStart() + "\n");
    }

    return { ok: true, filePath };
  } catch {
    return { ok: false, filePath };
  }
}

export function uninstallAutoPrompt(tool: string, location: "project" | "global"): { ok: boolean; filePath: string | null } {
  const filePath = getInstructionFilePath(tool, location);
  if (!filePath) return { ok: false, filePath: null };

  try {
    if (!fs.existsSync(filePath)) return { ok: true, filePath };

    let content = fs.readFileSync(filePath, "utf-8");
    if (!content.includes("promptly:auto-prompt:start")) {
      return { ok: true, filePath };
    }

    const config = TOOL_INSTRUCTION_PATHS[tool];
    const original = content;
    content = removeBlock(content, config.format);

    // Only write if content actually changed
    if (content !== original) {
      fs.writeFileSync(filePath, content);
    }

    return { ok: true, filePath };
  } catch {
    return { ok: false, filePath };
  }
}

function replaceBlock(content: string, format: ToolFormat, newBlock: string): string {
  const startMarker = format === "markdown" ? MARKER_START_MD : MARKER_START_COMMENT;
  const endMarker = format === "markdown" ? MARKER_END_MD : MARKER_END_COMMENT;

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return content;

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + endMarker.length);

  return before + newBlock.trimStart() + after;
}

function removeBlock(content: string, format: ToolFormat): string {
  const startMarker = format === "markdown" ? MARKER_START_MD : MARKER_START_COMMENT;
  const endMarker = format === "markdown" ? MARKER_END_MD : MARKER_END_COMMENT;

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return content;

  // Preserve everything before and after the block exactly as-is.
  // Only strip the single newline that we added when appending.
  const before = content.slice(0, startIdx);
  let after = content.slice(endIdx + endMarker.length);

  // Remove at most one leading newline from after (the trailing \n we wrote)
  if (after.startsWith("\n")) {
    after = after.slice(1);
  }

  // If block was at the end, trim at most one trailing newline from before
  // (the separator newline we added when appending)
  if (after === "" && before.endsWith("\n\n")) {
    return before.slice(0, -1);
  }

  return before + after;
}

// --- Status helper ---

export interface AutoPromptStatus {
  tool: string;
  label: string;
  projectPath: string | null;
  globalPath: string | null;
  projectEnabled: boolean;
  globalEnabled: boolean;
}

export function getAutoPromptStatus(tool: string, label: string): AutoPromptStatus {
  const projectPath = getInstructionFilePath(tool, "project");
  const globalPath = getInstructionFilePath(tool, "global");

  return {
    tool,
    label,
    projectPath,
    globalPath,
    projectEnabled: projectPath ? hasAutoPrompt(projectPath) : false,
    globalEnabled: globalPath ? hasAutoPrompt(globalPath) : false,
  };
}

// --- Interactive installer ---

interface ConfiguredTools {
  claude?: boolean;
  codex?: boolean;
  gemini?: boolean;
  vscode?: boolean;
  cursor?: boolean;
  windsurf?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  vscode: "VS Code + Copilot",
  cursor: "Cursor",
  windsurf: "Windsurf",
};

export async function installAutoPromptInteractive(configuredTools: ConfiguredTools): Promise<void> {
  const tools = Object.entries(configuredTools).filter(([, configured]) => configured);
  if (tools.length === 0) return;

  // Check if any tool needs auto-prompt
  const needsInstall: { tool: string; label: string }[] = [];
  for (const [tool] of tools) {
    const projectPath = getInstructionFilePath(tool, "project");
    const globalPath = getInstructionFilePath(tool, "global");
    const projectEnabled = projectPath ? hasAutoPrompt(projectPath) : false;
    const globalEnabled = globalPath ? hasAutoPrompt(globalPath) : false;

    if (!projectEnabled && !globalEnabled) {
      needsInstall.push({ tool, label: TOOL_LABELS[tool] ?? tool });
    }
  }

  if (needsInstall.length === 0) return;

  console.log("\n--- Auto-Prompt ---");
  console.log("Your AI tool will offer session tracking at the start of each conversation.");

  const doInstall = await confirm({
    message: "Enable auto-prompt?",
    default: true,
  });

  if (!doInstall) return;

  for (const { tool, label } of needsInstall) {
    const result = installAutoPrompt(tool, "project");
    const fileName = result.filePath ? path.basename(result.filePath) : "?";

    if (result.ok) {
      const relativePath = result.filePath
        ? path.relative(process.cwd(), result.filePath)
        : fileName;
      // For global paths, show abbreviated path
      const displayPath = result.filePath?.startsWith(os.homedir())
        ? result.filePath.replace(os.homedir(), "~")
        : relativePath;
      console.log(`  ${label.padEnd(20)} → ${displayPath} ✓`);
    } else {
      console.log(`  ${label.padEnd(20)} → failed`);
    }
  }

  console.log("\nAuto-prompt enabled. Restart your AI tools to activate.");
}
