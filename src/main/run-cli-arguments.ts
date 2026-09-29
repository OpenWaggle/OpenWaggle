import { validateCommandCliOptions } from './command-cli-option-contract'
import { hasFlag, option, type ParsedArguments, parseMcpCliArguments } from './mcp-cli-arguments'
import { validateSessionsCliOptions } from './sessions-cli-option-contract'

export const RUN_CLI_USAGE = `OpenWaggle run

Run an agent without opening the desktop app. The Session is saved like any other
and appears in the desktop app whenever it is open.

Usage:
  openwaggle run <prompt...> [options]
  openwaggle run (--text <prompt>|--stdin|--input-file <path>) [options]

Options:
  --project <path>               Project directory (default: current directory)
  --attach <path>                Attach a file; repeat for more files
  --title <title>                Session title
  --workspace current|local|existing|new-worktree
    [--workspace-id <id>] [--base-ref <ref>] [--start-from-origin]
  --agent <name>                 Use an Agent definition
  --model <provider/model>       Model for this Session
  --thinking <level>             Thinking level for this Run
  --authorization ask-for-approval|yolo, --yolo
  --interaction-timeout-ms <ms>  Stop waiting for an unanswered question after <ms>
  --jsonl                        Print Session Host event records instead of text
  --idempotency-key <key>        Reuse a key to reattach to the Run it started
  --profile <name> [--credential-stdin|--profile-credential-file <path>]
  -h, --help                     Show this help

The agent's reply streams to stdout. Progress, tool activity, and questions go to
stderr. In an interactive terminal you can answer approval prompts inline; otherwise
answer them in the desktop app or with 'openwaggle sessions requests respond'.
Press Ctrl-C to interrupt the Run, and Ctrl-C again to stop waiting for it.

Exit status:
  0    the Run completed
  1    the Run failed, or its result could not be read
  2    usage error
  3-6  authentication, authorization, not found, or conflict
  7    a question timed out (--interaction-timeout-ms)
  8    the Session Host is unavailable or exited
  130  the Run was interrupted`

const RUN_OPTIONS = [
  'project',
  'text',
  'stdin',
  'input-file',
  'attach',
  'title',
  'workspace',
  'workspace-id',
  'base-ref',
  'start-from-origin',
  'agent',
  'model',
  'thinking',
  'authorization',
  'yolo',
  'interaction-timeout-ms',
  'jsonl',
  'profile',
  'credential-stdin',
  'profile-credential-file',
  'idempotency-key',
] as const

const RUN_BOOLEAN_OPTIONS = new Set([
  'stdin',
  'start-from-origin',
  'yolo',
  'jsonl',
  'credential-stdin',
])
const RUN_ONLY_OPTIONS = new Set(['project', 'jsonl'])
const HELP_ARGUMENTS = new Set(['-h', '--help'])

export type RunCliInvocation =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'run'
      /** Arguments for the equivalent `sessions launch <project>` command. */
      readonly launchArguments: ParsedArguments
      readonly jsonl: boolean
    }

function isHelpRequest(args: readonly string[], parsed: ParsedArguments) {
  if (args.length === 1 && HELP_ARGUMENTS.has(args[0] ?? '')) return true
  return parsed.options.has('help')
}

/**
 * Parse `openwaggle run` and translate it into the equivalent `sessions launch` arguments,
 * so both commands share one validation and payload path.
 */
export function parseRunCliArguments(args: readonly string[]): RunCliInvocation {
  const parsed = parseMcpCliArguments(args)
  if (isHelpRequest(args, parsed)) return { kind: 'help' }
  const withoutPassthrough: ParsedArguments = { ...parsed, passthrough: [] }
  validateCommandCliOptions({
    surface: 'OpenWaggle',
    route: 'run',
    arguments: withoutPassthrough,
    optionsByRoute: { run: RUN_OPTIONS },
    booleanOptions: RUN_BOOLEAN_OPTIONS,
  })
  const promptWords = [...parsed.positionals, ...parsed.passthrough]
  const prompt = promptWords.join(' ')
  const explicitInput =
    parsed.options.has('text') || parsed.options.has('stdin') || parsed.options.has('input-file')
  if (prompt.length > 0 && explicitInput) {
    throw new Error(
      'Provide the prompt either as arguments or with --text, --stdin, or --input-file, not both.',
    )
  }
  if (prompt.trim().length === 0 && !explicitInput) {
    throw new Error('A prompt is required: openwaggle run <prompt> (see openwaggle run --help).')
  }
  const options = new Map([...parsed.options].filter(([name]) => !RUN_ONLY_OPTIONS.has(name)))
  if (prompt.length > 0) options.set('text', [prompt])
  const launchArguments: ParsedArguments = {
    positionals: [option(parsed, 'project') ?? '.'],
    passthrough: [],
    options,
  }
  validateSessionsCliOptions('launch', launchArguments)
  return { kind: 'run', launchArguments, jsonl: hasFlag(parsed, 'jsonl') }
}
