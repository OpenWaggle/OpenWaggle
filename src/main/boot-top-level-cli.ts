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
 * Answers `openwaggle --version`, `--help` and usage errors from the boot shim, before the 25 MB
 * main bundle loads (A-F15): they need only the argument router and the app version, and agents
 * and scripts run them often. Returns false for every other invocation, having touched nothing,
 * so the main bundle routes it as before. The answers are the ones top-level-cli-entry.ts prints.
 */
export function answerTopLevelCliInBoot(input: BootTopLevelCliInput): boolean {
  let outputFd: number | null
  try {
    outputFd = parseCliOutputFd(input.cliOutputFd)
  } catch {
    // The main bundle reports a malformed descriptor the way every command does.
    return false
  }
  const argv = applicationCliArguments(input.argv, { isPackaged: app.isPackaged })
  const route = routeTopLevelCli(argv, nodeTopLevelCliEnvironment(app.isPackaged))
  const answer = topLevelCliAnswer(route, app.getVersion())
  if (!answer) return false
  hideCliFromDock(input.platform)
  ignoreCliOutputStreamErrors()
  writeCliOutputAndExit(() => writeAnswer(answer, outputFd), answer.exitCode, writeStderr)
  return true
}
