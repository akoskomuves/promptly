import Anthropic from "@anthropic-ai/sdk";
import type { ConversationTurn } from "@getpromptly/shared";
import type { Rubric } from "./rubric.js";

export interface Verdict {
  score: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
  suggestedRewrite: string | null;
}

export interface JudgeResult {
  rubricId: string;
  rubricVersion: number;
  judgeModel: string;
  verdict: Verdict;
  cost: {
    inputTokens: number;
    outputTokens: number;
    inputUsd: number;
    outputUsd: number;
    totalUsd: number;
  };
}

// Haiku 4.5 pricing per million tokens (Anthropic, late 2026)
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
};

const ROLE_LABEL: Record<ConversationTurn["role"], string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
};

function renderTranscript(turns: ConversationTurn[]): string {
  return turns
    .map((turn, idx) => {
      const header = `[turn ${idx + 1}] ${ROLE_LABEL[turn.role]}`;
      const tools =
        turn.toolCalls && turn.toolCalls.length > 0
          ? `\n(tools called: ${turn.toolCalls.map((t) => t.name).join(", ")})`
          : "";
      return `${header}\n${turn.content}${tools}`;
    })
    .join("\n\n---\n\n");
}

function extractVerdict(responseText: string, rubricId: string): Verdict {
  const tagMatch = responseText.match(/<verdict>\s*([\s\S]*?)\s*<\/verdict>/);
  const jsonSource = tagMatch ? tagMatch[1] : responseText;

  const fence = jsonSource.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : jsonSource).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Judge for rubric ${rubricId} returned unparseable verdict. Raw response:\n${responseText}`
    );
  }

  const obj = parsed as Record<string, unknown>;
  const score = typeof obj.score === "number" ? obj.score : Number(obj.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error(`Judge returned invalid score: ${obj.score}`);
  }
  const confidence = obj.confidence;
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
    throw new Error(`Judge returned invalid confidence: ${confidence}`);
  }
  const rationale = typeof obj.rationale === "string" ? obj.rationale : "";
  const rewrite = obj.suggested_rewrite;
  const suggestedRewrite =
    rewrite === null || rewrite === undefined || rewrite === "" ? null : String(rewrite);

  return { score, confidence, rationale, suggestedRewrite };
}

export interface RunJudgeOptions {
  rubric: Rubric;
  turns: ConversationTurn[];
  model?: string;
  apiKey?: string;
}

export async function runJudge(opts: RunJudgeOptions): Promise<JudgeResult> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it in your shell and re-run."
    );
  }
  const model = opts.model ?? opts.rubric.modelDefault;
  const client = new Anthropic({ apiKey });

  const transcript = renderTranscript(opts.turns);

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: opts.rubric.systemPrompt,
    messages: [
      {
        role: "user",
        content: `Score the following session on **${opts.rubric.title}**.\n\nTranscript:\n\n${transcript}\n\nReturn your verdict in the required JSON format inside <verdict> tags.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const responseText = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const verdict = extractVerdict(responseText, opts.rubric.id);

  const pricing = PRICING[model] ?? PRICING["claude-haiku-4-5"];
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const inputUsd = (inputTokens / 1_000_000) * pricing.input;
  const outputUsd = (outputTokens / 1_000_000) * pricing.output;

  return {
    rubricId: opts.rubric.id,
    rubricVersion: opts.rubric.version,
    judgeModel: model,
    verdict,
    cost: {
      inputTokens,
      outputTokens,
      inputUsd,
      outputUsd,
      totalUsd: inputUsd + outputUsd,
    },
  };
}
