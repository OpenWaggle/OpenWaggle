/** The ordinary options that replaced inline JSON before 1.0, by the command that takes them. */

/** How `request-respond` answers each kind of request; it reads the request to pick the kind. */
export const INTERACTION_RESPONSE_OPTIONS = [
  'choice',
  'text',
  'stdin',
  'input-file',
  'confirm',
  'decline',
  'acknowledge',
  'dismiss',
  'value-file',
] as const
export const EVIDENCE_OPTIONS = [
  'evidence-command',
  'evidence-diff',
  'evidence-note',
  'evidence-artifact',
  'evidence-source',
] as const
export const CLAIM_OPTIONS = [
  'read',
  'write',
  'read-tree',
  'write-tree',
  'read-resource',
  'write-resource',
] as const
/** The spawn Delegation options plus dependencies and handoff; left out, a field keeps its value. */
export const SPECIFICATION_OPTIONS = [
  'objective',
  'deliverable',
  'accept',
  'resource',
  'depends-on',
  'handoff',
  'no-deliverables',
  'no-acceptance-criteria',
  'no-resources',
  'no-dependencies',
  'no-handoff',
] as const

/** The options above that take no value. */
export const INPUT_BOOLEAN_OPTIONS = [
  'confirm',
  'decline',
  'acknowledge',
  'dismiss',
  'no-deliverables',
  'no-acceptance-criteria',
  'no-resources',
  'no-dependencies',
  'no-handoff',
] as const
