import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

export interface Rubric {
  id: string;
  version: number;
  title: string;
  description: string;
  modelDefault: string;
  systemPrompt: string;
}

const RUBRICS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "rubrics");

function parseFrontmatter(source: string): { meta: Record<string, string>; body: string } {
  if (!source.startsWith("---\n")) {
    return { meta: {}, body: source };
  }
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) {
    return { meta: {}, body: source };
  }
  const meta: Record<string, string> = {};
  for (const line of source.slice(4, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body: source.slice(end + 5).trimStart() };
}

export function loadRubric(id: string): Rubric {
  const path = join(RUBRICS_DIR, `${id}.md`);
  const source = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(source);

  const required = ["id", "version", "title", "description", "model_default"] as const;
  for (const key of required) {
    if (!meta[key]) {
      throw new Error(`Rubric ${id} missing required frontmatter: ${key}`);
    }
  }

  return {
    id: meta.id,
    version: Number(meta.version),
    title: meta.title,
    description: meta.description,
    modelDefault: meta.model_default,
    systemPrompt: body.trim(),
  };
}

export function listRubrics(): string[] {
  return readdirSync(RUBRICS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}
