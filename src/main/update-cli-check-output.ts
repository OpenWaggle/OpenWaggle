import type { UpdateChannel } from '@shared/types/update-channel'
import { CLI_EXIT, CliError } from './cli-error'
import { SESSIONS_CLI_OUTPUT_SCHEMA_VERSION } from './cli-output-schema'
import { writeCliStdout } from './cli-stdout'
import { cliErrorBody, sessionsCliResponseText } from './sessions-cli-output'

const MS_PER_SECOND = 1_000
/**
 * install.sh stops waiting for `--check --json` after 60 s. The release check gives up well before
 * that, so a stalled GitHub response still ends in an error envelope that carries the saved channel.
 */
export const UPDATE_CHECK_JSON_TIMEOUT_MS = 30 * MS_PER_SECOND

/** What `openwaggle update --check --json` found. */
export type UpdateCheckStatus = 'available' | 'up-to-date' | 'no-release'

/**
 * The `result` of `openwaggle update --check --json`. `savedChannel` is the update channel the app
 * and CLI share; `install.sh` reads it to keep that channel on a re-run. `channel` is the channel
 * that was checked, absent for an exact `--version`. `version` is set when one is available.
 */
export interface UpdateCheckResult {
  readonly savedChannel: UpdateChannel
  readonly channel?: UpdateChannel
  readonly status: UpdateCheckStatus
  readonly version?: string
}

/** Set for `--check --json`, once the Session Host has reported the saved channel. */
export interface UpdateCheckMachineOutput {
  readonly savedChannel: UpdateChannel
}

export async function writeUpdateCheckResult(result: UpdateCheckResult) {
  await writeCliStdout(sessionsCliResponseText('update', result, true))
  return { exitCode: CLI_EXIT.SUCCESS, updaterOwnsExit: false }
}

/**
 * The CLI error envelope, `{schemaVersion, type: "error", error: {kind, message, code?}}`, with an
 * additive `savedChannel` once the Session Host has reported it. A failed release check then still
 * tells `install.sh` the channel to keep, instead of looking like an install with no channel.
 */
export function writeUpdateCheckError(
  error: unknown,
  savedChannel: UpdateChannel,
  stderr: (value: string) => unknown = (value) => process.stderr.write(value),
) {
  const body = cliErrorBody(error)
  stderr(
    `${JSON.stringify({
      schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
      type: 'error',
      error: body,
      savedChannel,
    })}\n`,
  )
  return body.kind
}

/** Fails with a `timeout` CLI error when the release check of `--check --json` takes too long. */
export function withinUpdateCheckDeadline<T>(
  work: Promise<T>,
  timeoutMs = UPDATE_CHECK_JSON_TIMEOUT_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new CliError(
          'timeout',
          `The release check did not finish within ${timeoutMs / MS_PER_SECOND} seconds.`,
        ),
      )
    }, timeoutMs)
  })
  // The check keeps running after the deadline; its late failure must not go unhandled.
  void work.catch(() => undefined)
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}
