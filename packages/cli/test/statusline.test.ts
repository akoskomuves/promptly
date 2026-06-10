import { describe, it, expect } from "vitest";
import { isOtherProject } from "../src/commands/statusline";

describe("isOtherProject", () => {
  it("hides the indicator only when both dirs are known and differ", () => {
    expect(isOtherProject("/a/promptly", "/a/wikicatch")).toBe(true);
    expect(isOtherProject("/a/promptly", "/a/promptly")).toBe(false);
  });

  it("shows the indicator when either side is unknown (legacy sessions, manual runs)", () => {
    expect(isOtherProject(undefined, "/a/wikicatch")).toBe(false);
    expect(isOtherProject("/a/promptly", undefined)).toBe(false);
    expect(isOtherProject(undefined, undefined)).toBe(false);
  });

  it("normalizes paths before comparing", () => {
    expect(isOtherProject("/a/promptly/", "/a/promptly")).toBe(false);
    expect(isOtherProject("/a/./promptly", "/a/promptly")).toBe(false);
  });

  it("treats subdirectories as the same project (either direction)", () => {
    // session cwd is a subdir of the recorded project
    expect(isOtherProject("/a/promptly", "/a/promptly/packages/cli")).toBe(false);
    // recording was started from a subdir, session reports the root
    expect(isOtherProject("/a/promptly/packages/cli", "/a/promptly")).toBe(false);
    // sibling with a shared prefix is still another project
    expect(isOtherProject("/a/promptly", "/a/promptly-cloud")).toBe(true);
  });
});
