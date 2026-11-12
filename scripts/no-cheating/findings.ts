/**
 * A no-cheating finding and its one-line form, `file:line [no-cheating/<kind>] message`. The kinds
 * are the ones the "No cheating" section of .agents/standards.md lists.
 */
export type FindingKind =
  | 'suppression'
  | 'cast'
  | 'tsconfig'
  | 'lint-config'
  | 'test'
  | 'budget'
  | 'only-shrinks'
  | 'generated-file'

export interface Finding {
  readonly file: string
  readonly line?: number
  readonly id: FindingKind
  readonly message: string
}

export function formatFinding(finding: Finding) {
  return `${finding.file}:${finding.line ?? 1} [no-cheating/${finding.id}] ${finding.message}`
}
