import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildWorkflowSkill,
  buildInstructionRule,
  buildHookArtifacts,
  writeArtifact,
  mergeHookIntoSettings,
} from "../src/commands/optimize-apply";

let cwd: string;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "promptly-apply-test-"));
});

describe("buildWorkflowSkill", () => {
  it("generates a runnable skill with all steps and the rec marker", () => {
    const a = buildWorkflowSkill(
      "repetitive-workflow:abc",
      ["pnpm lint", "pnpm test", "git commit"],
      cwd
    );
    expect(a.filePath).toBe(path.join(cwd, ".claude", "skills", "pnpm-lint-pnpm-test-git-commit", "SKILL.md"));
    expect(a.content).toContain("name: pnpm-lint-pnpm-test-git-commit");
    expect(a.content).toContain("1. `pnpm lint`");
    expect(a.content).toContain("3. `git commit`");
    expect(a.content).toContain("promptly:applied:repetitive-workflow:abc");
  });
});

describe("buildInstructionRule", () => {
  it("wraps correction phrases in a marker block targeting the project instruction file", () => {
    const a = buildInstructionRule("repeated-correction:xyz", ["use pnpm, not npm"], cwd);
    expect(a.mode).toBe("append");
    expect(a.content).toContain('- "use pnpm, not npm"');
    expect(a.content).toContain("promptly:rule:repeated-correction:xyz:start");
    expect(a.content).toContain("promptly:rule:repeated-correction:xyz:end");
  });
});

describe("buildHookArtifacts", () => {
  it("post direction: PostToolUse triggered by `before`, runs `after`", () => {
    const { script, patch } = buildHookArtifacts(
      "pre-post-action:post:git commit->pnpm lint",
      "post",
      "git commit",
      "pnpm lint",
      cwd
    );
    expect(patch.event).toBe("PostToolUse");
    expect(script.content).toContain('"git commit"*)');
    expect(script.content).toContain("pnpm lint");
    expect(script.executable).toBe(true);
  });

  it("pre direction: PreToolUse triggered by `after`, runs `before`", () => {
    const { script, patch } = buildHookArtifacts(
      "pre-post-action:pre:pnpm lint->git commit",
      "pre",
      "pnpm lint",
      "git commit",
      cwd
    );
    expect(patch.event).toBe("PreToolUse");
    expect(script.content).toContain('"git commit"*)');
    expect(script.content).toContain("pnpm lint");
  });
});

describe("writeArtifact", () => {
  it("creates files with parent dirs and sets the executable bit", () => {
    const { script } = buildHookArtifacts("r1", "post", "git commit", "pnpm lint", cwd);
    expect(writeArtifact(script)).toBe(true);
    expect(fs.existsSync(script.filePath)).toBe(true);
    expect(fs.statSync(script.filePath).mode & 0o111).toBeTruthy();
  });

  it("is idempotent: re-applying the same artifact is a skip, not a duplicate", () => {
    const a = buildInstructionRule("r2", ["always use TypeScript strict"], cwd);
    expect(writeArtifact(a)).toBe(true);
    expect(writeArtifact(a)).toBe(false);
    const content = fs.readFileSync(a.filePath, "utf-8");
    expect(content.match(/promptly:rule:r2:start/g)).toHaveLength(1);
  });

  it("appends to an existing instruction file without clobbering it", () => {
    const claudeMd = path.join(cwd, "CLAUDE.md");
    fs.writeFileSync(claudeMd, "# My project\n\nExisting instructions.\n");
    const a = { ...buildInstructionRule("r3", ["rule"], cwd), filePath: claudeMd };
    expect(writeArtifact(a)).toBe(true);
    const content = fs.readFileSync(claudeMd, "utf-8");
    expect(content).toContain("Existing instructions.");
    expect(content).toContain("promptly:rule:r3:start");
  });

  it("refuses to overwrite an unrelated file in create mode", () => {
    const skill = buildWorkflowSkill("r4", ["pnpm test"], cwd);
    fs.mkdirSync(path.dirname(skill.filePath), { recursive: true });
    fs.writeFileSync(skill.filePath, "hand-written skill, no marker");
    expect(() => writeArtifact(skill)).toThrow(/already exists/);
    expect(fs.readFileSync(skill.filePath, "utf-8")).toBe("hand-written skill, no marker");
  });
});

describe("mergeHookIntoSettings", () => {
  it("creates settings.json with the hook entry", () => {
    const { patch } = buildHookArtifacts("r5", "post", "git commit", "pnpm lint", cwd);
    expect(mergeHookIntoSettings(patch)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(patch.settingsPath, "utf-8"));
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe("Bash");
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain("promptly-post-git-commit-pnpm-lint.sh");
  });

  it("preserves existing settings and is idempotent", () => {
    const settingsPath = path.join(cwd, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: "command", command: "promptly statusline" } }, null, 2)
    );
    const { patch } = buildHookArtifacts("r6", "pre", "pnpm lint", "git commit", cwd);
    expect(mergeHookIntoSettings(patch)).toBe(true);
    expect(mergeHookIntoSettings(patch)).toBe(false);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.statusLine.command).toBe("promptly statusline");
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });
});
