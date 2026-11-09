import { CommandCliUsageError } from './command-cli-option-contract'
import type { ParsedArguments } from './mcp-cli-arguments'

const RESPONSE_FLAGS =
  '--choice <item>, --text <text>, --stdin, --input-file <path>, --confirm, --decline, --acknowledge, --dismiss or --value-file <path|->'

/**
 * Options that took inline JSON before 1.0, refused with the ordinary options that replaced them.
 * As with the `sessions` to `hive` rename, there are no aliases.
 */
const FORMER_OPTIONS: Readonly<Record<string, (command: string) => string>> = {
  'management-envelope-json': () =>
    'Use --manage-capability <capability>... with --manage-all, or any of --manage-project <path>..., --manage-session <id>... and --manage-hive <root-id>..., and optionally --manage-export-root <path>..., --manage-attachment-root <path>... and --manage-authorization ask-for-approval|yolo.',
  'response-json': (command) =>
    command === 'approval-respond'
      ? "Use 'openwaggle hive approval-respond <session-id> <run-id> <interaction-id> allow|deny [--for once|session|project]'."
      : command === 'request-respond'
        ? `Answer with ${RESPONSE_FLAGS}.`
        : `Use 'approval-respond ... allow|deny [--for once|session|project]', or 'request-respond' with ${RESPONSE_FLAGS}.`,
  'claim-json': () =>
    'Use --read <path>, --write <path>, --read-tree <dir>, --write-tree <dir>, --read-resource <project|repository>:<namespace>/<name> or --write-resource <project|repository>:<namespace>/<name>, each repeatable.',
  'evidence-json': () =>
    'Use --evidence-command <summary>, --evidence-diff <summary>, --evidence-note <summary>, --evidence-artifact <path-or-url> or --evidence-source <reference>, each repeatable.',
  'specification-json': () =>
    'Use --objective <text>, --deliverable <text>..., --accept <criterion>..., --resource <reference>..., --depends-on <delegation-id>[:accepted]... and --handoff <text>. Options you leave out keep their current value.',
  'request-json': () => 'Use --request-file <path|->.',
}

/** Refuses an option renamed before 1.0, naming the options to use instead. */
export function refuseFormerCliOptions(command: string, arguments_: ParsedArguments) {
  const former = [...arguments_.options.keys()]
    .sort()
    .find((name) => Object.hasOwn(FORMER_OPTIONS, name))
  if (former === undefined) return
  const hint = FORMER_OPTIONS[former]?.(command) ?? ''
  throw new CommandCliUsageError(`--${former} was replaced before 1.0. ${hint}`)
}
