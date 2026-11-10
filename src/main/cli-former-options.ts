import { CommandCliUsageError } from './command-cli-option-contract'
import type { ParsedArguments } from './mcp-cli-arguments'

const RESPONSE_FLAGS =
  '--choice <item>, --text <text>, --stdin, --input-file <path>, --confirm, --decline, --acknowledge, --dismiss or --value-file <path|->'

/** The CLI an option belonged to; elsewhere it stays an ordinary unknown option. */
export type FormerOptionCli = 'access' | 'hive'

/**
 * Options that took inline JSON before 1.0, refused with the ordinary options that replaced them.
 * As with the `sessions` to `hive` rename, there are no aliases.
 */
const ACCESS_FORMER_OPTIONS: Readonly<Record<string, (command: string) => string>> = {
  'management-envelope-json': () =>
    'Use --manage-capability <capability>... with --manage-all, or any of --manage-project <path>..., --manage-session <id>... and --manage-hive <root-id>..., and optionally --manage-export-root <path>..., --manage-attachment-root <path>... and --manage-authorization ask-for-approval|yolo.',
}

const HIVE_FORMER_OPTIONS: Readonly<Record<string, (command: string) => string>> = {
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
    'Use --objective <text>, --deliverable <text>..., --accept <criterion>..., --resource <reference>..., --depends-on <delegation-id>[:accepted]... and --handoff <text>, or --no-deliverables, --no-acceptance-criteria, --no-resources, --no-dependencies and --no-handoff to empty a field. Options you leave out keep their current value. delegation-amend --proposal <proposal-id> applies a proposal as proposed.',
  'request-json': () => 'Use --request-file <path|->.',
}

/** Refuses an option this CLI renamed before 1.0, naming the options to use instead. */
export function refuseFormerCliOptions(
  cli: FormerOptionCli,
  command: string,
  arguments_: ParsedArguments,
) {
  const formerOptions = cli === 'access' ? ACCESS_FORMER_OPTIONS : HIVE_FORMER_OPTIONS
  const former = [...arguments_.options.keys()]
    .sort()
    .find((name) => Object.hasOwn(formerOptions, name))
  if (former === undefined) return
  const hint = formerOptions[former]?.(command) ?? ''
  throw new CommandCliUsageError(`--${former} was replaced before 1.0. ${hint}`)
}
