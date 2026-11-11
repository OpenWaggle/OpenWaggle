/**
 * Turns a gate verdict into the message the agent reads, and decides with the loop guard whether
 * the run continues. A new set of blocking findings goes back to the agent once; the same set at
 * the next stop, or any set once the run cannot continue, ends the run silently: the findings are
 * already in the agent's context from the block, and `check` reports them again. The user never
 * gets a message. Advisory findings and tool failures never block and only the manual check prints
 * them. Output stays small: one header line, then one line per finding.
 */
import {
  type Finding,
  type ToolFailure,
  findingSetKey,
  formatFailure,
  formatFinding,
} from './findings'

/** Findings shown per message; the manual check prints the rest. */
export const MAX_SHOWN_FINDINGS = 30
const QUALITY_RULE = /^(?:fallow|react-doctor)\//u

export type GateDecision =
  | { readonly kind: 'pass' }
  | { readonly kind: 'block'; readonly content: string; readonly key: string }
  | { readonly kind: 'stop'; readonly key: string }

export interface LoopState {
  /** The set blocked at the end of the previous turn. */
  readonly blocked: string | undefined
  /** The set the loop guard gave up on; it no longer blocks. */
  readonly given: string | undefined
}

function findingLines(findings: readonly Finding[]) {
  const shown = findings.slice(0, MAX_SHOWN_FINDINGS).map(formatFinding)
  const hidden = findings.length - shown.length
  return hidden > 0 ? [...shown, `... ${hidden} more; run bun scripts/agent-gate/check.ts`] : shown
}

function advisoryLines(findings: readonly Finding[], failures: readonly ToolFailure[]) {
  const advisory = findings.filter((finding) => finding.severity === 'advisory')
  if (advisory.length === 0 && failures.length === 0) return []
  return ['Advisory, does not block:', ...findingLines(advisory), ...failures.map(formatFailure)]
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function decide(
  findings: readonly Finding[],
  state: LoopState,
  canContinue: boolean,
): GateDecision {
  const blocking = findings.filter((finding) => finding.severity === 'block')
  if (blocking.length === 0) return { kind: 'pass' }
  const key = findingSetKey(blocking)
  if (key === state.given) return { kind: 'pass' }
  if (key === state.blocked || !canContinue) return { kind: 'stop', key }
  return {
    kind: 'block',
    key,
    content: [
      `Agent gate: ${plural(blocking.length, 'finding')} in files you changed. Fix them before you stop; if you cannot, say why [GATE-01]:`,
      ...findingLines(blocking),
      ...(blocking.some((finding) => QUALITY_RULE.test(finding.rule))
        ? [
            'A Fallow or React Doctor false positive gets a commented entry in .fallowrc.jsonc or doctor.config.ts, never a suppression comment [GATE-02].',
          ]
        : []),
    ].join('\n'),
  }
}

/** The loop state after a decision. */
export function nextLoopState(state: LoopState, decision: GateDecision): LoopState {
  if (decision.kind === 'block') return { blocked: decision.key, given: state.given }
  if (decision.kind === 'stop') return { blocked: undefined, given: decision.key }
  return { blocked: undefined, given: state.given }
}

/** The manual check's output: one line when clean, else only the findings. */
export function checkReport(
  findings: readonly Finding[],
  failures: readonly ToolFailure[],
  files: number,
  seconds: string,
) {
  const blocking = findings.filter((finding) => finding.severity === 'block')
  const advisory = advisoryLines(findings, failures)
  if (blocking.length === 0) {
    return [
      `agent-gate: no blocking findings in ${plural(files, 'file')} (${seconds}s)`,
      ...advisory,
    ]
  }
  return [
    ...blocking.map(formatFinding),
    ...advisory,
    `agent-gate: ${plural(blocking.length, 'blocking finding')} in ${plural(files, 'file')} (${seconds}s)`,
  ]
}
