import type { PrefixSessionRole } from './session-identity-rows'

/**
 * The most o200k tokens an empty project's first model request may carry before any user text,
 * per Session role. A ratchet: lower it whenever the prefix shrinks; raising it needs a reason in
 * the pull request. The v1 target is 4,000 for every role (decision 6 of the v1 performance plan).
 *
 * Each budget is the integrated v1 measurement plus about 3%, because the machine's temporary and
 * package paths appear in the prompt: 3,787 independent, 3,790 Queen, 3,788 Worker (1.0.0-beta.27
 * measured 13,304, 13,301 and 11,289).
 */
export const FIRST_TURN_PREFIX_BUDGETS: Readonly<Record<PrefixSessionRole, number>> = {
  independent: 3_900,
  queen: 3_905,
  worker: 3_905,
}
