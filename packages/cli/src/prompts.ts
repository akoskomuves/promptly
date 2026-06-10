/**
 * TTY-aware wrappers around @inquirer/prompts.
 *
 * Promptly is routinely driven from inside AI coding sessions and scripts,
 * where stdin is not a TTY and inquirer prompts die immediately
 * ("User force closed the prompt"). Every interactive command must go
 * through these wrappers instead of importing @inquirer/prompts directly:
 *
 * - In a real terminal they behave exactly like inquirer.
 * - Without a TTY (or with --yes via setAssumeYes) they fall back to the
 *   prompt's default and print what was chosen, or fail with an actionable
 *   hint when there is no safe default.
 */
import {
  confirm as inquirerConfirm,
  select as inquirerSelect,
  checkbox as inquirerCheckbox,
  input as inquirerInput,
} from "@inquirer/prompts";

let assumeYes = false;

/** Set by --yes flags: accept every prompt's default without asking. */
export function setAssumeYes(value: boolean): void {
  assumeYes = value;
}

function shouldPrompt(): boolean {
  return !assumeYes && Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function logFallback(message: string, value: string): void {
  const reason = assumeYes ? "--yes" : "non-interactive";
  console.log(`${message} ${value} (${reason}, using default)`);
}

interface PromptChoice<V> {
  name?: string;
  value: V;
  description?: string;
  checked?: boolean;
}

export async function confirm(opts: {
  message: string;
  default?: boolean;
}): Promise<boolean> {
  if (!shouldPrompt()) {
    const value = opts.default ?? true;
    logFallback(opts.message, value ? "yes" : "no");
    return value;
  }
  return inquirerConfirm(opts);
}

export async function select<V>(opts: {
  message: string;
  choices: PromptChoice<V>[];
  default?: V;
  /** Shown when the prompt can't run and has no default, e.g. "Use --session <id>". */
  nonInteractiveHint?: string;
}): Promise<V> {
  const { nonInteractiveHint, ...rest } = opts;
  if (!shouldPrompt()) {
    if (rest.default !== undefined) {
      const chosen = rest.choices.find((c) => c.value === rest.default);
      logFallback(rest.message, chosen?.name ?? String(rest.default));
      return rest.default;
    }
    throw new Error(
      `"${rest.message}" needs an interactive terminal.` +
        (nonInteractiveHint ? ` ${nonInteractiveHint}` : "")
    );
  }
  return inquirerSelect(rest as Parameters<typeof inquirerSelect>[0]) as Promise<V>;
}

export async function checkbox<V>(opts: {
  message: string;
  choices: PromptChoice<V>[];
}): Promise<V[]> {
  if (!shouldPrompt()) {
    // Pre-checked choices are the authored default; if none, take all.
    const checked = opts.choices.filter((c) => c.checked);
    const fallback = (checked.length > 0 ? checked : opts.choices).map((c) => c.value);
    logFallback(
      opts.message,
      fallback.map((v) => String(v)).join(", ") || "(none)"
    );
    return fallback;
  }
  return inquirerCheckbox(opts as Parameters<typeof inquirerCheckbox>[0]) as Promise<V[]>;
}

export async function input(opts: {
  message: string;
  default?: string;
  /** Shown when the prompt can't run and has no default, e.g. "Use --ticket <id>". */
  nonInteractiveHint?: string;
}): Promise<string> {
  const { nonInteractiveHint, ...rest } = opts;
  if (!shouldPrompt()) {
    if (rest.default !== undefined) {
      logFallback(rest.message, rest.default);
      return rest.default;
    }
    throw new Error(
      `"${rest.message}" needs an interactive terminal.` +
        (nonInteractiveHint ? ` ${nonInteractiveHint}` : "")
    );
  }
  return inquirerInput(rest);
}
