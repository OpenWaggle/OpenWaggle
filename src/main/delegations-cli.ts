import { isCommandCliUsageError, validateImplicitCliHelp } from './command-cli-option-contract'
import { validateDelegationsCliOptions } from './delegations-cli-option-contract'
import { buildDelegationsCliPayload } from './delegations-cli-payload'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, parseMcpCliArguments } from './mcp-cli-arguments'
import {
  SESSION_CLI_EXIT as EXIT,
  sessionCliExitCodeForError,
  sessionCliResultErrorKind,
} from './session-cli-exit-status'
import { executeLocalSessionCommand } from './session-host/local-session-client'

const JSON_INDENT_SPACES = 2

export function delegationsCliUsage() {
  return `OpenWaggle Delegations

Usage:
  openwaggle delegations list [--parent <session>] [--worker <session>] [--state <state>]...
  openwaggle delegations read <delegation-id>
  openwaggle delegations conflicts [--delegation <id>] [--kind live-overlap|merge-overlap] [--status unacknowledged|acknowledged|resolved]
  openwaggle delegations submit <worker-id> <delegation-id> <summary> [--evidence-json <json>]...
  openwaggle delegations state <worker-id> <delegation-id> working|waiting|needs_attention <reason>
  openwaggle delegations claim <worker-id> <delegation-id> <reason> [--claim-json <json>]...
  openwaggle delegations acknowledge-conflict <parent-id> <delegation-id> <conflict-id> <reason>
  openwaggle delegations dependency <parent-id> <delegation-id> add|remove <dependency-id> ready_for_review|accepted <reason>
  openwaggle delegations propose-amendment <worker-id> <delegation-id> <base-revision> <reason> --specification-json <json>
  openwaggle delegations amend <parent-id> <delegation-id> <expected-revision> <reason> --specification-json <json> [--proposal <id>]
  openwaggle delegations verify <parent-id> <delegation-id> <submission-revision> passed|failed|inconclusive <summary> [--evidence-json <json>]...
  openwaggle delegations request-revision <parent-id> <delegation-id> <revision> <feedback>
    [--revised-objective <text>] [--deliverable <text>]... [--accept <criterion>]...
    [--resource <reference>]...
  openwaggle delegations accept <parent-id> <delegation-id> <revision> [note]
  openwaggle delegations reopen <parent-id> <delegation-id> <reason>
  openwaggle delegations cancel <parent-id> <delegation-id> <reason>

Catalog: --project <path> | --all, --parent <session>, --worker <session>, --limit <n>, --cursor <cursor>
Common: --json, --profile <name> [--credential-stdin|--profile-credential-file <path>]
Mutation replay: --idempotency-key <key>
Unknown, missing-value, command-inapplicable, unexpected positional, and -- passthrough input
fail before a query or mutation is sent. Documented summary, reason, feedback, and note text may span
multiple positional words.
`
}

export async function runDelegationsCli(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  const arguments_ = { ...parsed, positionals: parsed.positionals.slice(1) }
  try {
    if (!command) {
      validateImplicitCliHelp('OpenWaggle Delegations', parsed)
      process.stdout.write(delegationsCliUsage())
      return EXIT.SUCCESS
    }
    validateDelegationsCliOptions(command, arguments_)
    if (command === 'help') {
      process.stdout.write(delegationsCliUsage())
      return EXIT.SUCCESS
    }
    const client = await createLocalSessionCliClientInput(arguments_)
    const result = await executeLocalSessionCommand({
      ...client,
      payload: buildDelegationsCliPayload(command, arguments_, {
        ...(client.workingDirectory ? { workingDirectory: client.workingDirectory } : {}),
      }),
    })
    process.stdout.write(
      `${JSON.stringify(result, null, hasFlag(arguments_, 'json') ? JSON_INDENT_SPACES : undefined)}\n`,
    )
    const resultError = sessionCliResultErrorKind(result)
    return resultError ? sessionCliExitCodeForError(resultError) : EXIT.SUCCESS
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return isCommandCliUsageError(error) ? EXIT.USAGE : EXIT.FAILURE
  }
}
