/**
 * The agent gate's finding shape and its one-line form, `file:line:col rule [ID] message`, the
 * shape lint output uses. `ID` is the rule catalogue ID (.agents/rules.json) when the rule has one.
 */
export type Severity = 'block' | 'advisory'

export interface Finding {
  readonly file: string
  readonly line?: number
  readonly column?: number
  /** The lint rule, TypeScript code or `gate/<check>` that found it. */
  readonly rule: string
  readonly id?: string
  readonly message: string
  readonly severity: Severity
}

/** A check that could not run (timeout, missing tool, offline); its files stay unchecked. */
export interface ToolFailure {
  readonly check: string
  readonly files: readonly string[]
  readonly reason: string
}

export function formatFinding(finding: Finding) {
  const id = finding.id === undefined ? '' : ` [${finding.id}]`
  return `${finding.file}:${finding.line ?? 1}:${finding.column ?? 1} ${finding.rule}${id} ${finding.message}`
}

export function formatFailure(failure: ToolFailure) {
  const files = failure.files.length === 1 ? '1 file stays' : `${failure.files.length} files stay`
  return `gate: ${failure.check} did not run (${failure.reason}); ${files} unchecked for the next gate`
}

/**
 * Identifies a set of blocking findings for the loop guard. Lines and columns are left out, so an
 * edit that only moves a finding does not count as a new set.
 */
export function findingSetKey(findings: readonly Finding[]) {
  return [
    ...new Set(findings.map((finding) => `${finding.file} ${finding.rule} ${finding.message}`)),
  ]
    .sort()
    .join('\n')
}

const LOCATED_LINE =
  /^(?<file>[^\s:][^:]*):(?<line>\d+):(?<column>\d+) (?<rule>\S+)(?: \[(?<id>[A-Z]+-\d{2})\])? (?<message>.*)$/u

/** Reads one `file:line:col rule [ID] message` line, as compact lint output prints it. */
export function parseFindingLine(line: string, severity: Severity): Finding | undefined {
  const groups = LOCATED_LINE.exec(line)?.groups
  if (groups === undefined) return undefined
  const { file = '', rule = '', message = '', id } = groups
  return {
    file,
    line: Number(groups['line']),
    column: Number(groups['column']),
    rule,
    ...(id === undefined ? {} : { id }),
    message,
    severity,
  }
}
