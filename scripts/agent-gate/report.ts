/**
 * Turns a gate verdict into what the agent and the user read, and decides with the loop guard
 * whether the turn may end. A new set of blocking findings blocks once; the same set at the end of
 * the next turn goes to the user and the turn ends. Advisory findings and tool failures never
 * block. Output stays small: one header line, then one line per finding.
 */
import {
  type Finding,
  type ToolFailure,
  findingSetKey,
  formatFailure,
  formatFinding,
} from './findings'

export const GATE_MESSAGE_TYPE = 'openwaggle-agent-gate'
/** Findings shown per message; the manual check prints the rest. */
export const MAX_SHOWN_FINDINGS = 30
const QUALITY_RULE = /^(?:fallow|react-doctor)\//u

export type GateDecision =
  | { readonly kind: 'pass'; readonly content: string | undefined }
  | { readonly kind: 'block'; readonly content: string; readonly key: string }
  | { readonly kind: 'handoff'; readonly content: string; readonly key: string }

export interface LoopState {
  /** The set blocked at the end of the previous turn. */
  readonly blocked: string | undefined
  /** The set already handed to the user; it no longer blocks. */
  readonly handedOff: string | undefined
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
  failures: readonly ToolFailure[],
  state: LoopState,
  canContinue: boolean,
): GateDecision {
  const blocking = findings.filter((finding) => finding.severity === 'block')
  const advisory = advisoryLines(findings, failures)
  if (blocking.length === 0) {
    return {
      kind: 'pass',
      content: advisory.length > 0 ? ['Agent gate passed.', ...advisory].join('\n') : undefined,
    }
  }
  const key = findingSetKey(blocking)
  if (key === state.handedOff) {
    return { kind: 'pass', content: advisory.length > 0 ? advisory.join('\n') : undefined }
  }
  if (key === state.blocked || !canContinue) {
    return {
      kind: 'handoff',
      key,
      content: [
        `Agent gate: ${plural(blocking.length, 'finding')} remain after the agent's retry; over to you [GATE-01]:`,
        ...findingLines(blocking),
        ...advisory,
      ].join('\n'),
    }
  }
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
      ...advisory,
    ].join('\n'),
  }
}

/** The loop state after a decision. */
export function nextLoopState(state: LoopState, decision: GateDecision): LoopState {
  if (decision.kind === 'block') return { blocked: decision.key, handedOff: state.handedOff }
  if (decision.kind === 'handoff') return { blocked: undefined, handedOff: decision.key }
  return { blocked: undefined, handedOff: state.handedOff }
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
