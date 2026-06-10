import { describe, it, expect, afterEach } from "vitest";
import { confirm, select, checkbox, input, setAssumeYes } from "../src/prompts";

// Vitest runs without a TTY, so these tests exercise exactly the fallback
// paths that AI agents and scripts hit in the wild.

afterEach(() => setAssumeYes(false));

describe("non-TTY prompt fallbacks", () => {
  it("confirm returns its default without prompting", async () => {
    expect(await confirm({ message: "Install?", default: true })).toBe(true);
    expect(await confirm({ message: "Install globally?", default: false })).toBe(false);
    expect(await confirm({ message: "No default" })).toBe(true);
  });

  it("select returns its default when one is set", async () => {
    const period = await select({
      message: "Select time period:",
      choices: [
        { name: "Today", value: "today" },
        { name: "Last 30 days", value: "month" },
      ],
      default: "month",
    });
    expect(period).toBe("month");
  });

  it("select without a default fails with the actionable hint", async () => {
    await expect(
      select({
        message: "Select a team:",
        choices: [{ name: "Acme", value: "acme" }],
        nonInteractiveHint: "Pass the slug directly: promptly team set <slug>",
      })
    ).rejects.toThrow(/promptly team set <slug>/);
  });

  it("checkbox returns the pre-checked choices", async () => {
    const tools = await checkbox({
      message: "Select tools:",
      choices: [
        { name: "Claude Code", value: "claude", checked: true },
        { name: "Cursor", value: "cursor", checked: true },
        { name: "Windsurf", value: "windsurf", checked: false },
      ],
    });
    expect(tools).toEqual(["claude", "cursor"]);
  });

  it("checkbox falls back to all choices when none are pre-checked", async () => {
    const tools = await checkbox({
      message: "Select tools:",
      choices: [
        { name: "A", value: "a" },
        { name: "B", value: "b" },
      ],
    });
    expect(tools).toEqual(["a", "b"]);
  });

  it("input returns its default, and fails with hint when there is none", async () => {
    expect(await input({ message: "Ticket ID", default: "untitled" })).toBe("untitled");
    await expect(
      input({ message: "Ticket ID", nonInteractiveHint: "Use --ticket <id>." })
    ).rejects.toThrow(/--ticket/);
  });

  it("setAssumeYes(true) accepts defaults even when prompts would run", async () => {
    setAssumeYes(true);
    expect(await confirm({ message: "Install?", default: true })).toBe(true);
    expect(await confirm({ message: "Install globally?", default: false })).toBe(false);
  });
});
