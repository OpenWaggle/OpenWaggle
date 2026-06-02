import { execFile } from 'node:child_process'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { BASE_TEN } from '@shared/constants/math'
import { BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { getSafeChildEnv } from '../env'
import { ExtensionBuildRunnerError } from '../errors'
import { ExtensionBuildRunner } from '../ports/extension-build-runner'

const BUILD_MAX_BUFFER = BASE_TEN * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE
const SUCCESS_EXIT_CODE = 0

function childEnv(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(getSafeChildEnv())) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

function shellCommand() {
  return process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
}

function shellArgs(command: string) {
  return process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command]
}

function exitCode(error: { readonly code?: string | number | null }) {
  return typeof error.code === 'number' ? error.code : null
}

function failedStderr(error: { readonly message: string }, stderr: string) {
  return stderr.trim().length > 0 ? stderr : error.message
}

function runBuildCommand(input: {
  readonly packagePath: string
  readonly command: string
}): Promise<{
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}> {
  return new Promise((resolve) => {
    execFile(
      shellCommand(),
      shellArgs(input.command),
      {
        cwd: input.packagePath,
        env: childEnv(),
        encoding: 'utf8',
        maxBuffer: BUILD_MAX_BUFFER,
        timeout: OPENWAGGLE_EXTENSION.LIMITS.BUILD_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            exitCode: exitCode(error),
            stdout,
            stderr: failedStderr(error, stderr),
          })
          return
        }

        resolve({
          exitCode: SUCCESS_EXIT_CODE,
          stdout,
          stderr,
        })
      },
    )
  })
}

export const ExtensionBuildRunnerLive = Layer.succeed(
  ExtensionBuildRunner,
  ExtensionBuildRunner.of({
    run: (input) =>
      Effect.tryPromise({
        try: () => runBuildCommand(input),
        catch: (cause) => new ExtensionBuildRunnerError({ operation: 'run', cause }),
      }),
  }),
)
