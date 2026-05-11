// Optimization detectors — analyze sessions to surface AI spend leaks
// with concrete dollar-savings estimates based on the user's own data.

export interface OptimizeSessionInput {
  id: string;
  ticketId: string;
  startedAt: string;
  finishedAt?: string | null;
  totalTokens: number;
  promptTokens: number;
  responseTokens: number;
  models: string[];
  intelligence?: {
    qualityScore?: {
      overall: number;
      turnsToComplete: number;
      correctionRate: number;
    };
    contextMetrics?: {
      peakTokenCount: number;
      summarizationEvents: number;
      contextUtilization: number;
    };
  } | null;
  // User-side message text only — detectors that mine conversation content
  // (e.g. repeated-corrections) read from here. Optional so detectors that
  // only need aggregates work without populating it.
  userMessages?: string[];
  // Normalized Bash invocations in chronological order — first 1-2 tokens of
  // each Bash tool call. Used by repetitive-workflow detection.
  bashSequence?: string[];
}

export interface ModelPricing {
  input_price_per_million: number;
  output_price_per_million: number;
}

export interface OptimizationInput {
  sessions: OptimizeSessionInput[];
  pricing: Record<string, ModelPricing> | null;
  windowDays: number;
}

interface BaseEvidence {
  sessionId: string;
  ticketId: string;
  model: string;
}

export interface ModelMisuseEvidence extends BaseEvidence {
  kind: "model-misuse";
  currentCost: number;
  alternativeCost: number;
  alternativeModel: string;
  qualityScore: number;
  turnsToComplete: number;
}

export interface ContextBloatEvidence extends BaseEvidence {
  kind: "context-bloat";
  totalCost: number;
  estimatedWaste: number;
  contextUtilization: number;
  summarizationEvents: number;
  peakTokenCount: number;
  qualityScore: number | null;
}

export interface RepeatedCorrectionEvidence {
  kind: "repeated-correction";
  sessionId: string;
  ticketId: string;
  originalPhrase: string;       // exact phrase as the user wrote it
  context?: string;             // first ~80 chars of the surrounding message
}

export interface RepetitiveWorkflowEvidence {
  kind: "repetitive-workflow";
  sessionId: string;
  ticketId: string;
  occurrenceCount: number;      // how many times the workflow ran in this session
}

export interface PrePostActionEvidence {
  kind: "pre-post-action";
  sessionId: string;
  ticketId: string;
  occurrences: number;          // how many times the (A,B) pair occurred here
}

export type OptimizationEvidence =
  | ModelMisuseEvidence
  | ContextBloatEvidence
  | RepeatedCorrectionEvidence
  | RepetitiveWorkflowEvidence
  | PrePostActionEvidence;

export type OptimizationType =
  | "model-misuse"
  | "context-bloat"
  | "repeated-corrections"
  | "repetitive-workflow"
  | "pre-post-action";

export interface OptimizationRecommendation {
  id: string;
  type: OptimizationType;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  evidence: OptimizationEvidence[];
  estimatedMonthlySavings: number;
  details?: Record<string, unknown>;
}

interface ModelClassification {
  isPremium: boolean;
  alternativeGuess?: string;       // first-pass exact-name substitution
  fallbackTierKeyword?: string;    // family-wide fuzzy search keyword if guess misses
}

/**
 * Pure name-based heuristic for premium-vs-cheaper model classification.
 * Returns both an exact alternative-name guess and a tier keyword for fuzzy
 * family fallback (e.g. opus-4-7 → guess sonnet-4-7, fallback to any sonnet
 * in the claude family if 4-7 sonnet isn't priced).
 */
function classifyModel(name: string): ModelClassification {
  const lower = name.toLowerCase();
  if (lower.includes("opus")) {
    return {
      isPremium: true,
      alternativeGuess: name.replace(/opus/gi, "sonnet"),
      fallbackTierKeyword: "sonnet",
    };
  }
  if (lower.includes("ultra")) {
    return {
      isPremium: true,
      alternativeGuess: name.replace(/ultra/gi, "pro"),
      fallbackTierKeyword: "pro",
    };
  }
  if (/-pro($|[^a-z])/i.test(lower)) {
    // For -pro variants the only sensible mapping is the same name minus -pro.
    // No fallback keyword — fuzzy family search would be misleading here.
    return {
      isPremium: true,
      alternativeGuess: name.replace(/-pro/gi, ""),
    };
  }
  return { isPremium: false };
}

function findPricing(
  pricing: Record<string, ModelPricing>,
  model: string
): ModelPricing | null {
  const direct = pricing[model] ?? pricing[model.toLowerCase()];
  if (direct) return direct;
  const lower = model.toLowerCase();
  for (const [key, val] of Object.entries(pricing)) {
    const k = key.toLowerCase();
    if (lower === k) return val;
    if (lower.startsWith(k) || k.startsWith(lower)) return val;
  }
  return null;
}

/**
 * Find a cheaper alternative for a premium model, with two-stage lookup:
 *   1. Exact substitution (e.g. claude-opus-4-7 → claude-sonnet-4-7)
 *   2. Fuzzy family search (e.g. any priced claude-* containing "sonnet")
 *      — pick the priciest match so we recommend the closest tier above the
 *      cheapest, not the floor (haiku would understate savings comparison).
 */
function findAlternative(
  pricing: Record<string, ModelPricing>,
  classification: ModelClassification,
  originalModel: string
): { name: string; pricing: ModelPricing } | null {
  if (!classification.alternativeGuess) return null;

  const direct = findPricing(pricing, classification.alternativeGuess);
  if (direct) return { name: classification.alternativeGuess, pricing: direct };

  if (!classification.fallbackTierKeyword) return null;

  const family = originalModel.toLowerCase().split("-")[0];
  const tierKw = classification.fallbackTierKeyword.toLowerCase();

  let best: { name: string; pricing: ModelPricing } | null = null;
  for (const [key, val] of Object.entries(pricing)) {
    const k = key.toLowerCase();
    if (!k.startsWith(family)) continue;
    if (!k.includes(tierKw)) continue;
    if (!best || val.input_price_per_million > best.pricing.input_price_per_million) {
      best = { name: key, pricing: val };
    }
  }
  return best;
}

function costFor(
  promptTokens: number,
  responseTokens: number,
  pricing: ModelPricing
): number {
  return (
    (promptTokens / 1_000_000) * pricing.input_price_per_million +
    (responseTokens / 1_000_000) * pricing.output_price_per_million
  );
}

function severityFromMonthlySavings(savings: number): "info" | "warning" | "critical" {
  if (savings >= 100) return "critical";
  if (savings >= 20) return "warning";
  return "info";
}

/**
 * Detector: premium model used for tasks that completed quickly, with high
 * quality and low corrections. A cheaper-tier model (sonnet vs opus, gpt-5.5
 * vs gpt-5.5-pro) likely would have produced the same result.
 *
 * Thresholds chosen to be conservative — false positives erode trust faster
 * than false negatives. Tune via the constants below.
 */
const MISUSE_MAX_TURNS = 5;
const MISUSE_MIN_QUALITY = 4;
const MISUSE_MAX_CORRECTION_RATE = 0.2;

export function detectModelMisuse(
  input: OptimizationInput
): OptimizationRecommendation[] {
  if (!input.pricing) return [];
  const evidence: ModelMisuseEvidence[] = [];
  let totalSavings = 0;

  for (const session of input.sessions) {
    const quality = session.intelligence?.qualityScore;
    if (!quality) continue;
    if (quality.overall < MISUSE_MIN_QUALITY) continue;
    if (quality.turnsToComplete > MISUSE_MAX_TURNS) continue;
    if (quality.correctionRate >= MISUSE_MAX_CORRECTION_RATE) continue;
    if (session.models.length === 0) continue;

    const model = session.models[0];
    const classification = classifyModel(model);
    if (!classification.isPremium) continue;

    const currentPrice = findPricing(input.pricing, model);
    if (!currentPrice) continue;

    const alternative = findAlternative(input.pricing, classification, model);
    if (!alternative) continue;

    const currentCost = costFor(session.promptTokens, session.responseTokens, currentPrice);
    const altCost = costFor(session.promptTokens, session.responseTokens, alternative.pricing);
    const delta = currentCost - altCost;
    if (delta <= 0.001) continue;

    evidence.push({
      kind: "model-misuse",
      sessionId: session.id,
      ticketId: session.ticketId,
      model,
      currentCost,
      alternativeCost: altCost,
      qualityScore: quality.overall,
      turnsToComplete: quality.turnsToComplete,
      alternativeModel: alternative.name,
    });
    totalSavings += delta;
  }

  if (evidence.length === 0) return [];

  evidence.sort((a, b) => b.currentCost - b.alternativeCost - (a.currentCost - a.alternativeCost));

  const monthlySavings = Math.round(((totalSavings * 30) / input.windowDays) * 100) / 100;
  const exampleAlt = evidence[0].alternativeModel;

  return [{
    id: "model-misuse",
    type: "model-misuse",
    severity: severityFromMonthlySavings(monthlySavings),
    title: "Premium model used for simple tasks",
    description: `${evidence.length} session${evidence.length === 1 ? "" : "s"} used a premium model for tasks completed in ${MISUSE_MAX_TURNS} turns or fewer with quality ${MISUSE_MIN_QUALITY}+/5 and a correction rate under ${Math.round(MISUSE_MAX_CORRECTION_RATE * 100)}%. The same outcome was likely reachable with a cheaper-tier model${exampleAlt ? ` (e.g. ${exampleAlt})` : ""}.`,
    evidence,
    estimatedMonthlySavings: monthlySavings,
    details: {
      thresholds: {
        maxTurns: MISUSE_MAX_TURNS,
        minQuality: MISUSE_MIN_QUALITY,
        maxCorrectionRate: MISUSE_MAX_CORRECTION_RATE,
      },
    },
  }];
}

/**
 * Detector: sessions where the context window saturated (peak >=80%) AND
 * triggered at least one summarization/compaction event AND were token-heavy
 * enough to have material cost. Splitting the work into smaller scopes would
 * have avoided the context-restoration overhead.
 *
 * Savings estimator is deliberately conservative: only the utilization above
 * 80% is treated as potential waste, and only half of that is counted as
 * avoidable. Better to undershoot than overpromise.
 */
const BLOAT_MIN_UTILIZATION = 0.8;
const BLOAT_MIN_TOKENS = 100_000;
const BLOAT_WASTE_CALIBRATION = 0.5;

export function detectContextBloat(
  input: OptimizationInput
): OptimizationRecommendation[] {
  if (!input.pricing) return [];
  const evidence: ContextBloatEvidence[] = [];
  let totalWaste = 0;

  for (const session of input.sessions) {
    const ctx = session.intelligence?.contextMetrics;
    if (!ctx) continue;
    if (ctx.contextUtilization < BLOAT_MIN_UTILIZATION) continue;
    if (ctx.summarizationEvents < 1) continue;
    if (session.totalTokens < BLOAT_MIN_TOKENS) continue;
    if (session.models.length === 0) continue;

    const model = session.models[0];
    const price = findPricing(input.pricing, model);
    if (!price) continue;

    const sessionCost = costFor(session.promptTokens, session.responseTokens, price);
    const wasteFraction = Math.max(0, ctx.contextUtilization - BLOAT_MIN_UTILIZATION) * BLOAT_WASTE_CALIBRATION;
    const estimatedWaste = sessionCost * wasteFraction;
    if (estimatedWaste <= 0.001) continue;

    evidence.push({
      kind: "context-bloat",
      sessionId: session.id,
      ticketId: session.ticketId,
      model,
      totalCost: sessionCost,
      estimatedWaste,
      contextUtilization: ctx.contextUtilization,
      summarizationEvents: ctx.summarizationEvents,
      peakTokenCount: ctx.peakTokenCount,
      qualityScore: session.intelligence?.qualityScore?.overall ?? null,
    });
    totalWaste += estimatedWaste;
  }

  if (evidence.length === 0) return [];

  evidence.sort((a, b) => b.estimatedWaste - a.estimatedWaste);

  const monthlySavings = Math.round(((totalWaste * 30) / input.windowDays) * 100) / 100;

  return [{
    id: "context-bloat",
    type: "context-bloat",
    severity: severityFromMonthlySavings(monthlySavings),
    title: "Context window saturation in long sessions",
    description: `${evidence.length} session${evidence.length === 1 ? "" : "s"} hit context-window saturation (peak utilization ${Math.round(BLOAT_MIN_UTILIZATION * 100)}%+ with at least one summarization event) on token-heavy work. Splitting these into smaller scopes — closing the session and starting fresh between subtasks — would save an estimated $${monthlySavings.toFixed(2)}/mo in context-restoration overhead. Estimate is conservative; actual savings depend on how reusable the context was.`,
    evidence,
    estimatedMonthlySavings: monthlySavings,
    details: {
      thresholds: {
        minUtilization: BLOAT_MIN_UTILIZATION,
        minTokens: BLOAT_MIN_TOKENS,
        wasteCalibration: BLOAT_WASTE_CALIBRATION,
      },
    },
  }];
}

/**
 * Detector: phrases the user repeats across multiple sessions ("don't use X",
 * "always do Y") signal an instruction-file gap — the rule belongs in
 * CLAUDE.md / .cursorrules / equivalent so it doesn't have to be re-typed.
 *
 * Three-stage pipeline:
 *   1. Regex-extract correction-style phrases from each user message.
 *   2. Fingerprint each phrase (drop stop words, sort tokens, take top 6) so
 *      "don't use any" / "please don't use any anymore" cluster together.
 *   3. Surface only patterns appearing in 5+ distinct sessions — random noise
 *      rarely clears that bar.
 *
 * Dollar savings here are tiny (~$0.10/mo even at 100 corrections). The real
 * value is smoother sessions — frame the recommendation around occurrence
 * count and example phrases, with $/mo as a footnote.
 */
// Boundary uses a lookahead on non-letter/non-space so trailing digits or
// punctuation don't prevent a match (e.g. "don't use any types in foo 1" —
// the trailing " 1" used to abort the whole match).
const CORRECTION_PATTERNS: RegExp[] = [
  /\bdon['']?t\s+([a-z][a-z\s]{2,40}?)(?=[^a-z\s]|$)/i,
  /\bnever\s+([a-z][a-z\s]{2,40}?)(?=[^a-z\s]|$)/i,
  /\balways\s+([a-z][a-z\s]{2,40}?)(?=[^a-z\s]|$)/i,
  /\bstop\s+([a-z][a-z\s]{2,40}?)(?=[^a-z\s]|$)/i,
  /\buse\s+([a-z][a-z\s]{2,30}?)\s+instead\b/i,
];

// Quantifiers like "any"/"some"/"all" are often the *content* of the correction
// ("don't use any") so they're deliberately NOT in this list.
const STOP_WORDS = new Set([
  "the", "a", "an", "this", "that", "these", "those",
  "to", "of", "for", "in", "on", "at", "by", "with", "from",
  "and", "or", "but", "so", "if", "as",
  "is", "are", "was", "were", "be", "been", "being",
  "you", "i", "we", "it", "its", "your", "my", "our",
  "do", "does", "did", "doing", "have", "has", "had",
  "can", "could", "would", "should", "will", "may", "might",
  "just", "also", "very", "really", "please", "now", "then",
]);

const CORRECTION_REPEAT_THRESHOLD = 5;
const CORRECTION_TOKENS_PER_OCCURRENCE = 1500;
const CORRECTION_FALLBACK_BLENDED_PRICE_PER_MILLION = 5;

function extractCorrections(message: string): string[] {
  const matches: string[] = [];
  for (const pattern of CORRECTION_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(message)) !== null) {
      const phrase = m[1]?.trim();
      if (phrase && phrase.length >= 3) matches.push(phrase);
    }
  }
  return matches;
}

// First 2 distinctive tokens, preserving order. "use types" ≠ "run types"
// (order matters), and we deliberately keep it short — long fingerprints
// dilute clustering when users phrase the same rule with different trailing
// context ("don't use any" vs "don't use any in this code").
function fingerprint(phrase: string): string {
  const tokens = phrase
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP_WORDS.has(t));
  return tokens.slice(0, 2).join(" ");
}

function blendedPricePerMillion(input: OptimizationInput): number {
  if (!input.pricing) return CORRECTION_FALLBACK_BLENDED_PRICE_PER_MILLION;
  const usedModels = new Set<string>();
  for (const s of input.sessions) for (const m of s.models) usedModels.add(m);

  const blendedPrices: number[] = [];
  for (const m of usedModels) {
    const p = findPricing(input.pricing, m);
    if (p) blendedPrices.push((p.input_price_per_million + p.output_price_per_million) / 2);
  }
  if (blendedPrices.length === 0) return CORRECTION_FALLBACK_BLENDED_PRICE_PER_MILLION;
  // Median is more robust than mean against outliers like Opus
  blendedPrices.sort((a, b) => a - b);
  return blendedPrices[Math.floor(blendedPrices.length / 2)];
}

interface CorrectionCluster {
  fingerprint: string;
  evidence: RepeatedCorrectionEvidence[];
  distinctSessions: Set<string>;
}

export function detectRepeatedCorrections(
  input: OptimizationInput
): OptimizationRecommendation[] {
  const clusters = new Map<string, CorrectionCluster>();

  for (const session of input.sessions) {
    if (!session.userMessages || session.userMessages.length === 0) continue;
    const seenInSession = new Set<string>();
    for (const message of session.userMessages) {
      if (!message || message.length < 10) continue;
      for (const phrase of extractCorrections(message)) {
        const fp = fingerprint(phrase);
        if (!fp) continue;
        // Don't double-count the same fingerprint within one session
        if (seenInSession.has(fp)) continue;
        seenInSession.add(fp);

        let cluster = clusters.get(fp);
        if (!cluster) {
          cluster = { fingerprint: fp, evidence: [], distinctSessions: new Set() };
          clusters.set(fp, cluster);
        }
        cluster.distinctSessions.add(session.id);
        const ctxStart = Math.max(0, message.toLowerCase().indexOf(phrase.toLowerCase().slice(0, 20)) - 10);
        cluster.evidence.push({
          kind: "repeated-correction",
          sessionId: session.id,
          ticketId: session.ticketId,
          originalPhrase: phrase,
          context: message.substring(ctxStart, ctxStart + 80).trim(),
        });
      }
    }
  }

  const pricePerMillion = blendedPricePerMillion(input);

  const recs: OptimizationRecommendation[] = [];
  for (const cluster of clusters.values()) {
    const occurrences = cluster.distinctSessions.size;
    if (occurrences < CORRECTION_REPEAT_THRESHOLD) continue;

    const wastedTokens = occurrences * CORRECTION_TOKENS_PER_OCCURRENCE;
    const periodCost = (wastedTokens / 1_000_000) * pricePerMillion;
    const monthlySavings = Math.round(((periodCost * 30) / input.windowDays) * 100) / 100;

    // Pick the most readable original phrase as the recommendation title
    const titlePhrase = cluster.evidence
      .map((e) => e.originalPhrase)
      .sort((a, b) => a.length - b.length)[0];

    recs.push({
      id: `repeated-correction:${cluster.fingerprint}`,
      type: "repeated-corrections",
      severity:
        occurrences >= 20 ? "critical" : occurrences >= 10 ? "warning" : "info",
      title: `Repeated correction — "${titlePhrase}"`,
      description: `Appeared in ${occurrences} distinct sessions over the last ${input.windowDays} days. Adding this rule to your instruction file (CLAUDE.md, .cursorrules, GEMINI.md, etc.) would eliminate the friction. Direct token waste is small (~$${monthlySavings.toFixed(2)}/mo) — the bigger win is fewer re-do cycles and less context bloat compounding.`,
      evidence: cluster.evidence.slice(0, 5),
      estimatedMonthlySavings: monthlySavings,
      details: {
        fingerprint: cluster.fingerprint,
        distinctSessions: occurrences,
        thresholds: {
          minDistinctSessions: CORRECTION_REPEAT_THRESHOLD,
          tokensPerOccurrence: CORRECTION_TOKENS_PER_OCCURRENCE,
        },
      },
    });
  }

  return recs.sort((a, b) =>
    (((b.details?.distinctSessions as number) ?? 0) - ((a.details?.distinctSessions as number) ?? 0))
  );
}

/**
 * Detector: multi-step Bash workflows (`npm test → npm run lint → git commit`)
 * that recur across sessions. Each is a candidate for a Claude Code skill /
 * Cursor command / Codex skill / Gemini command — automating it saves the
 * typing time + the AI's deliberation about which step comes next.
 *
 * Pipeline:
 *   1. For each session, take the normalized Bash sequence and emit all
 *      n-grams of length 2..4.
 *   2. Group n-grams by canonical join string. Track distinct sessions and
 *      total occurrences per cluster.
 *   3. Filter: ≥5 distinct sessions, length ≥2.
 *   4. Subsumption pass — drop a shorter n-gram if a longer one already
 *      surfaces with the same set of sessions (prevents 5 redundant recs
 *      for the same underlying workflow).
 *
 * Savings: time-based, not token-based. Each automated occurrence saves
 * ~30s (typing + AI deliberation). Monetized at $1/min as a transparent
 * placeholder so it sorts alongside the dollar detectors. The minutes
 * figure is the headline number in the description.
 */
const WORKFLOW_MIN_LENGTH = 2;
const WORKFLOW_MAX_LENGTH = 4;
const WORKFLOW_MIN_DISTINCT_SESSIONS = 5;
const WORKFLOW_SECONDS_PER_OCCURRENCE = 30;
const WORKFLOW_DOLLAR_PER_MINUTE = 1; // placeholder calibration

const MULTI_VERB_BINARIES = new Set([
  "git", "npm", "yarn", "pnpm", "cargo", "docker", "kubectl",
  "gh", "brew", "aws", "gcloud", "az", "make", "bun", "deno",
]);

export function normalizeBashCommand(cmd: string): string {
  // Use only the first line (drop heredocs / multi-line scripts beyond line 1)
  const trimmed = cmd.trim().split("\n")[0]?.trim();
  if (!trimmed) return "";
  // Strip env-var prefix like `FOO=bar npm test`
  const stripped = trimmed.replace(/^(\s*[A-Z_][A-Z0-9_]*=\S+\s+)+/, "");
  const tokens = stripped.split(/\s+/).filter((t) => t && !t.startsWith("-"));
  if (tokens.length === 0) return "";
  const first = tokens[0].toLowerCase();
  if (MULTI_VERB_BINARIES.has(first) && tokens[1] && /^[a-z]/i.test(tokens[1])) {
    return `${first} ${tokens[1].toLowerCase()}`;
  }
  return first;
}

interface WorkflowCluster {
  sequence: string[];
  distinctSessions: Set<string>;
  occurrencesBySession: Map<string, number>;
}

function clusterKey(sequence: string[]): string {
  return sequence.join(" ");
}

function isContiguousSubsequence(short: string[], long: string[]): boolean {
  if (short.length >= long.length) return false;
  outer: for (let i = 0; i + short.length <= long.length; i++) {
    for (let j = 0; j < short.length; j++) {
      if (long[i + j] !== short[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function detectRepetitiveWorkflow(
  input: OptimizationInput
): OptimizationRecommendation[] {
  const clusters = new Map<string, WorkflowCluster>();

  for (const session of input.sessions) {
    const seq = session.bashSequence;
    if (!seq || seq.length < WORKFLOW_MIN_LENGTH) continue;

    // Per-session occurrence counter for each n-gram, so a session that
    // runs the same workflow twice reflects that in monthly savings.
    const sessionCounts = new Map<string, number>();

    for (let n = WORKFLOW_MIN_LENGTH; n <= WORKFLOW_MAX_LENGTH; n++) {
      for (let i = 0; i + n <= seq.length; i++) {
        const ngram = seq.slice(i, i + n);
        const key = clusterKey(ngram);
        sessionCounts.set(key, (sessionCounts.get(key) ?? 0) + 1);
      }
    }

    for (const [key, count] of sessionCounts) {
      let cluster = clusters.get(key);
      if (!cluster) {
        const sequence = key.split(" ");
        cluster = {
          sequence,
          distinctSessions: new Set(),
          occurrencesBySession: new Map(),
        };
        clusters.set(key, cluster);
      }
      cluster.distinctSessions.add(session.id);
      cluster.occurrencesBySession.set(session.id, count);
    }
  }

  // First filter by threshold
  const qualifying = Array.from(clusters.values()).filter(
    (c) => c.distinctSessions.size >= WORKFLOW_MIN_DISTINCT_SESSIONS
  );

  // Subsumption: drop a shorter cluster only if a longer one is a true
  // superset — same sessions AND at least as many per-session occurrences
  // everywhere. The per-session check handles the "ABABAB" trap: if the
  // user runs "AB" 12 times per session, we'd also see "ABAB" 10 times,
  // but "AB" is the real atomic workflow and we want to surface that one.
  qualifying.sort((a, b) => b.sequence.length - a.sequence.length);
  const kept: WorkflowCluster[] = [];
  for (const c of qualifying) {
    const subsumed = kept.some((k) => {
      if (k.sequence.length <= c.sequence.length) return false;
      if (!isContiguousSubsequence(c.sequence, k.sequence)) return false;
      for (const s of c.distinctSessions) {
        if (!k.distinctSessions.has(s)) return false;
        const shortCount = c.occurrencesBySession.get(s) ?? 0;
        const longCount = k.occurrencesBySession.get(s) ?? 0;
        if (shortCount > longCount) return false;
      }
      return true;
    });
    if (!subsumed) kept.push(c);
  }

  // Build recommendations
  const recs: OptimizationRecommendation[] = [];
  for (const cluster of kept) {
    const totalOccurrences = Array.from(cluster.occurrencesBySession.values())
      .reduce((s, n) => s + n, 0);
    const minutesPerWindow = (totalOccurrences * WORKFLOW_SECONDS_PER_OCCURRENCE) / 60;
    const monthlyMinutes = Math.round((minutesPerWindow * 30) / input.windowDays * 10) / 10;
    const monthlySavings = Math.round(monthlyMinutes * WORKFLOW_DOLLAR_PER_MINUTE * 100) / 100;

    const display = cluster.sequence.join(" → ");
    const evidence: RepetitiveWorkflowEvidence[] = Array.from(cluster.occurrencesBySession.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sessionId, occurrenceCount]) => {
        const session = input.sessions.find((s) => s.id === sessionId);
        return {
          kind: "repetitive-workflow" as const,
          sessionId,
          ticketId: session?.ticketId ?? sessionId,
          occurrenceCount,
        };
      });

    recs.push({
      id: `repetitive-workflow:${clusterKey(cluster.sequence)}`,
      type: "repetitive-workflow",
      severity:
        monthlyMinutes >= 30 ? "critical" : monthlyMinutes >= 10 ? "warning" : "info",
      title: `Repeated workflow — ${display}`,
      description: `This ${cluster.sequence.length}-step workflow ran ${totalOccurrences} time${totalOccurrences === 1 ? "" : "s"} across ${cluster.distinctSessions.size} sessions over the last ${input.windowDays} days. Automating it as a Claude Code skill, Cursor command, Codex skill, or Gemini command saves about ${monthlyMinutes} min/mo of typing + AI deliberation. Dollar figure ($${monthlySavings}/mo) is monetized at $${WORKFLOW_DOLLAR_PER_MINUTE}/min as a placeholder so it sorts alongside the dollar detectors.`,
      evidence,
      estimatedMonthlySavings: monthlySavings,
      details: {
        sequence: cluster.sequence,
        distinctSessions: cluster.distinctSessions.size,
        totalOccurrences,
        monthlyMinutes,
        thresholds: {
          minLength: WORKFLOW_MIN_LENGTH,
          maxLength: WORKFLOW_MAX_LENGTH,
          minDistinctSessions: WORKFLOW_MIN_DISTINCT_SESSIONS,
          secondsPerOccurrence: WORKFLOW_SECONDS_PER_OCCURRENCE,
          dollarPerMinute: WORKFLOW_DOLLAR_PER_MINUTE,
        },
      },
    });
  }

  return recs.sort((a, b) =>
    ((b.details?.monthlyMinutes as number) ?? 0) - ((a.details?.monthlyMinutes as number) ?? 0)
  );
}

/**
 * Detector: bigrams (A → B) where the second action is consistently preceded
 * by the first (or the first is consistently followed by the second). High
 * conditional probability is the signal — even if A→B only fires 5 times,
 * if B occurred 6 times total and 5 of those were preceded by A, that's
 * strong evidence A is a prerequisite that belongs in a hook.
 *
 * Distinct from repetitive-workflow: that one says "this 2-step sequence
 * repeats — automate as a skill". This one says "the second step is
 * statistically tied to the first — automate as a hook." Different actionable
 * outputs (manual `/skill` vs automatic hook), so overlap is acceptable.
 *
 * Savings: time per prevented manual invocation. Conservative ~10s
 * (typing + AI deliberation only — the action's actual execution time
 * isn't saved, just the friction of remembering to do it).
 */
const PREPOST_MIN_DISTINCT_SESSIONS = 5;
const PREPOST_PROB_THRESHOLD = 0.8;
const PREPOST_SECONDS_PER_OCCURRENCE = 10;

interface BigramStats {
  cooccurCount: number;
  sessions: Set<string>;
  occurrencesBySession: Map<string, number>;
}

export function detectPrePostAction(
  input: OptimizationInput
): OptimizationRecommendation[] {
  const cooccur = new Map<string, BigramStats>();
  const antecedentCount = new Map<string, number>();   // total times X appeared as antecedent
  const consequentCount = new Map<string, number>();   // total times X appeared as consequent

  for (const session of input.sessions) {
    const seq = session.bashSequence;
    if (!seq || seq.length < 2) continue;
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      antecedentCount.set(a, (antecedentCount.get(a) ?? 0) + 1);
      consequentCount.set(b, (consequentCount.get(b) ?? 0) + 1);
      const key = `${a} ${b}`;
      let stats = cooccur.get(key);
      if (!stats) {
        stats = { cooccurCount: 0, sessions: new Set(), occurrencesBySession: new Map() };
        cooccur.set(key, stats);
      }
      stats.cooccurCount++;
      stats.sessions.add(session.id);
      stats.occurrencesBySession.set(
        session.id,
        (stats.occurrencesBySession.get(session.id) ?? 0) + 1
      );
    }
  }

  const recs: OptimizationRecommendation[] = [];
  for (const [key, stats] of cooccur) {
    if (stats.sessions.size < PREPOST_MIN_DISTINCT_SESSIONS) continue;
    const [a, b] = key.split(" ");
    const aCount = antecedentCount.get(a) ?? 0;
    const bCount = consequentCount.get(b) ?? 0;
    const preProb = bCount > 0 ? stats.cooccurCount / bCount : 0;
    const postProb = aCount > 0 ? stats.cooccurCount / aCount : 0;

    const seconds = stats.cooccurCount * PREPOST_SECONDS_PER_OCCURRENCE;
    const monthlyMinutes = Math.round(((seconds / 60) * 30) / input.windowDays * 10) / 10;
    const monthlySavings = Math.round(monthlyMinutes * 100) / 100;

    const evidence: PrePostActionEvidence[] = Array.from(stats.occurrencesBySession.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([sessionId, occurrences]) => {
        const session = input.sessions.find((s) => s.id === sessionId);
        return {
          kind: "pre-post-action" as const,
          sessionId,
          ticketId: session?.ticketId ?? sessionId,
          occurrences,
        };
      });

    const baseSeverity =
      monthlyMinutes >= 10 ? "warning" : "info";

    if (preProb >= PREPOST_PROB_THRESHOLD) {
      recs.push({
        id: `pre-post-action:pre:${a}->${b}`,
        type: "pre-post-action",
        severity: baseSeverity,
        title: `Pre-action — \`${a}\` before \`${b}\``,
        description: `Almost every time \`${b}\` runs (${Math.round(preProb * 100)}% of ${bCount} occurrences), it's preceded by \`${a}\`. Set up a Claude Code pre-tool-use hook, a git pre-commit hook, or a shell alias so \`${a}\` runs automatically before \`${b}\` and you stop typing it. Saves about ${monthlyMinutes} min/mo of typing + deliberation.`,
        evidence,
        estimatedMonthlySavings: monthlySavings,
        details: {
          direction: "pre",
          before: a,
          after: b,
          cooccurCount: stats.cooccurCount,
          consequentCount: bCount,
          preProbability: Math.round(preProb * 100) / 100,
          distinctSessions: stats.sessions.size,
          monthlyMinutes,
          thresholds: {
            minDistinctSessions: PREPOST_MIN_DISTINCT_SESSIONS,
            probabilityThreshold: PREPOST_PROB_THRESHOLD,
            secondsPerOccurrence: PREPOST_SECONDS_PER_OCCURRENCE,
          },
        },
      });
    }

    if (postProb >= PREPOST_PROB_THRESHOLD) {
      recs.push({
        id: `pre-post-action:post:${a}->${b}`,
        type: "pre-post-action",
        severity: baseSeverity,
        title: `Post-action — \`${b}\` after \`${a}\``,
        description: `Almost every time \`${a}\` runs (${Math.round(postProb * 100)}% of ${aCount} occurrences), \`${b}\` follows. Set up a post-tool-use hook or chain with \`&&\` so \`${b}\` runs automatically after \`${a}\`. Saves about ${monthlyMinutes} min/mo of typing + deliberation.`,
        evidence,
        estimatedMonthlySavings: monthlySavings,
        details: {
          direction: "post",
          before: a,
          after: b,
          cooccurCount: stats.cooccurCount,
          antecedentCount: aCount,
          postProbability: Math.round(postProb * 100) / 100,
          distinctSessions: stats.sessions.size,
          monthlyMinutes,
          thresholds: {
            minDistinctSessions: PREPOST_MIN_DISTINCT_SESSIONS,
            probabilityThreshold: PREPOST_PROB_THRESHOLD,
            secondsPerOccurrence: PREPOST_SECONDS_PER_OCCURRENCE,
          },
        },
      });
    }
  }

  return recs.sort(
    (a, b) =>
      ((b.details?.monthlyMinutes as number) ?? 0) -
      ((a.details?.monthlyMinutes as number) ?? 0)
  );
}

/**
 * Public entry point — runs all enabled detectors and returns recommendations
 * sorted by estimated monthly savings (highest first).
 */
export function runOptimizationDetectors(
  input: OptimizationInput
): OptimizationRecommendation[] {
  const recs: OptimizationRecommendation[] = [
    ...detectModelMisuse(input),
    ...detectContextBloat(input),
    ...detectRepeatedCorrections(input),
    ...detectRepetitiveWorkflow(input),
    ...detectPrePostAction(input),
  ];
  return recs.sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings);
}
