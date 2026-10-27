import { app } from 'electron'
import { applicationCliArguments } from './application-cli-arguments'
import { parseCliOutputFd, writeAllToFd, writeWritableChunk } from './cli-output-writer'
import { type TopLevelCliAnswer, topLevelCliAnswer } from './top-level-cli-answer'
import { nodeTopLevelCliEnvironment } from './top-level-cli-environment'
import {
  hideCliFromDock,
  ignoreCliOutputStreamErrors,
  writeCliOutputAndExit,
} from './top-level-cli-exit'
import { routeTopLevelCli } from './top-level-cli-route'

export interface BootTopLevelCliInput {
  readonly argv: readonly string[]
  /** `OPENWAGGLE_CLI_OUTPUT_FD`, read by the boot shim (cli-output-writer.ts). */
  readonly cliOutputFd: string | undefined
  readonly platform: NodeJS.Platform
}

function writeStderr(text: string) {
  return writeWritableChunk(process.stderr, text)
}

function writeAnswer(answer: TopLevelCliAnswer, outputFd: number | null) {
  if (answer.stream === 'stderr') return writeStderr(answer.text)
  if (outputFd === null) return writeWritableChunk(process.stdout, answer.text)
  writeAllToFd(outputFd, answer.text)
  return Promise.resolve()
}

/**
 * What the boot shim did with an invocation: `answered` it and is exiting, or left it to the main
 * bundle, which opens the `desktop-app` window, runs the detached `session-host`, or runs a
 * command (`main-bundle`).
 */
export type BootTopLevelCliOutcome = 'answered' | 'desktop-app' | 'session-host' | 'main-bundle'

const SESSION_HOST_COMMAND = 'session-host-internal'

const DESKTOP_APP_ROUTES = new Set(['gui', 'open-project', 'open-session-link'])

/**
 * Answers `openwaggle --version`, `--help` and usage errors from the boot shim, before the 25 MB
 * main bundle loads (A-F15): they need only the argument router and the app version, and agents
 * and scripts run them often. Every other invocation is left untouched for the main bundle, which
 * routes it as before; the outcome says whether that opens the desktop app. The answers are the
 * ones top-level-cli-entry.ts prints.
 */
export function answerTopLevelCliInBoot(input: BootTopLevelCliInput): BootTopLevelCliOutcome {
  let outputFd: number | null
  try {
    outputFd = parseCliOutputFd(input.cliOutputFd)
  } catch {
    // The main bundle reports a malformed descriptor the way every command does.
    return 'main-bundle'
  }
  const argv = applicationCliArguments(input.argv, { isPackaged: app.isPackaged })
  const route = routeTopLevelCli(argv, nodeTopLevelCliEnvironment(app.isPackaged))
  const answer = topLevelCliAnswer(route, app.getVersion())
  if (!answer) {
    if (DESKTOP_APP_ROUTES.has(route.kind)) return 'desktop-app'
    if (route.kind === 'delegate' && route.argv[0] === SESSION_HOST_COMMAND) return 'session-host'
    return 'main-bundle'
  }
  hideCliFromDock(input.platform)
  ignoreCliOutputStreamErrors()
  writeCliOutputAndExit(() => writeAnswer(answer, outputFd), answer.exitCode, writeStderr)
  return 'answered'
}
