/**
 * A no-cheating finding and its one-line form, `file:line [ID] message`. `ID` is the rule
 * catalogue ID (.agents/rules.json) the change breaks.
 */
export interface Finding {
  readonly file: string
  readonly line?: number
  readonly id: string
  readonly message: string
}

export function formatFinding(finding: Finding) {
  return `${finding.file}:${finding.line ?? 1} [${finding.id}] ${finding.message}`
}
