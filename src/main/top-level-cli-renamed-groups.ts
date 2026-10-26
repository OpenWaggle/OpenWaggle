import type { ParsedArguments } from './mcp-cli-arguments'
import { formerGroupReplacement } from './sessions-cli-former-commands'

/** Groups renamed before 1.0 (ADR 0053); they are refused with the command they became. */
const RENAMED_GROUPS: Readonly<Record<string, string>> = {
  sessions: 'hive',
  delegations: 'hive',
}

const OPTION_PREFIX = '--'
/** A refusal quotes the group and its action, as `sessions list`. */
const QUOTED_TOKENS = 2

function formerArguments(tokens: readonly string[]): ParsedArguments {
  return {
    positionals: tokens.filter((token) => !token.startsWith('-')),
    passthrough: [],
    options: new Map(
      tokens
        .filter((token) => token.startsWith(OPTION_PREFIX))
        .map((token) => [token.slice(OPTION_PREFIX.length), ['true']]),
    ),
  }
}

/** The `hive` command a pre-1.0 `sessions <action>` or `delegations <action>` became. */
function renamedCommand(group: string, renamed: string, tokens: readonly string[]) {
  const [action, ...rest] = tokens.filter((token) => !token.startsWith('-'))
  if (action === undefined) return renamed
  const options = tokens.filter((token) => token.startsWith(OPTION_PREFIX))
  const replacement =
    group === 'delegations'
      ? (formerGroupReplacement('delegations', formerArguments([action])) ??
        formerGroupReplacement('delegation', formerArguments([action])))
      : (formerGroupReplacement(action, formerArguments([...rest, ...options])) ?? action)
  return replacement ? `${renamed} ${replacement}` : renamed
}

export function renamedGroupMessage(argv: readonly string[]) {
  const [group = '', ...tokens] = argv
  const renamed = RENAMED_GROUPS[group]
  if (!renamed) return undefined
  const typed = [group, ...tokens.filter((token) => !token.startsWith('-'))]
    .slice(0, QUOTED_TOKENS)
    .join(' ')
  return `unknown command '${typed}'. It is now '${renamedCommand(group, renamed, tokens)}'.`
}
