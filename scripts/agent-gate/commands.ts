/**
 * Reads shell commands the agent ran: which ones ran tests (TEST-05) and how they ended. A command
 * counts as a test run when any of its segments starts a test runner or a repository test script.
 */
const SEGMENT_SEPARATOR = /&&|\|\||[;|\n]/u
/** `timeout 300`, `env`, `FOO=1` and similar wrappers before the command itself. */
const COMMAND_PREFIX = String.raw`^(?:(?:timeout\s+\S+|env|nice|time|\w+=\S*)\s+)*`
const LAUNCHER = String.raw`(?:(?:bunx|npx|node|bun(?:\s+--bun)?(?:\s+x)?)\s+)?(?:\S*/)?`
const END = String.raw`(?:\s|$)`
const TEST_SEGMENT = new RegExp(
  [
    String.raw`${COMMAND_PREFIX}${LAUNCHER}(?:vitest|jest|playwright\s+test)${END}`,
    String.raw`${COMMAND_PREFIX}bun\s+(?:--bun\s+)?(?:test|run\s+(?:test(?::[\w:-]+)?|verify))${END}`,
    String.raw`${COMMAND_PREFIX}bun\s+scripts/check/run\.ts\s+verify`,
  ].join('|'),
  'u',
)
// `vitest --version` or `vitest --help` run nothing.
const NOT_A_TEST_RUN = /--(?:version|help)\b|\bvitest\s+(?:init|list)\b/u

export function isTestCommand(command: string) {
  return command
    .split(SEGMENT_SEPARATOR)
    .some((segment) => TEST_SEGMENT.test(segment.trim()) && !NOT_A_TEST_RUN.test(segment))
}

export interface CommandRun {
  readonly command: string
  /** The shell's exit status, or undefined when the tool did not report one. */
  readonly exitCode: number | undefined
  readonly failed: boolean
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The command and exit status of a bash tool result. */
export function bashRun(
  input: Readonly<Record<string, unknown>>,
  structuredContent: unknown,
  isError: boolean,
): CommandRun | undefined {
  const command = input['command']
  if (typeof command !== 'string') return undefined
  const exitCode = isRecord(structuredContent) ? structuredContent['exit_code'] : undefined
  return {
    command,
    exitCode: typeof exitCode === 'number' ? exitCode : undefined,
    failed: isError || (typeof exitCode === 'number' && exitCode !== 0),
  }
}
