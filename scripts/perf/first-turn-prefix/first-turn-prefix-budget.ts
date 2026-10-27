import type { PrefixSessionRole } from './session-identity-rows'

/**
 * The most o200k tokens an empty project's first model request may carry before any user text,
 * per Session role. A ratchet: lower it whenever the prefix shrinks; raising it needs a reason in
 * the pull request. The v1 target is 4,000 for every role (decision 6 of the v1 performance plan).
 *
 * Each budget is the 1.0.0-beta.27 (77b9814b5) measurement plus about 150 tokens, because the
 * machine's temporary and package paths appear in the prompt: 13,304 independent, 13,301 Queen,
 * 11,289 Worker.
 */
export const FIRST_TURN_PREFIX_BUDGETS: Readonly<Record<PrefixSessionRole, number>> = {
  independent: 13_450,
  queen: 13_450,
  worker: 11_450,
}
