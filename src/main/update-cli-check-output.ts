import type { UpdateChannel } from '@shared/types/update-channel'
import { CLI_EXIT } from './cli-error'
import { SESSIONS_CLI_OUTPUT_SCHEMA_VERSION } from './cli-output-schema'
import { writeCliStdout } from './cli-stdout'
import { classifySessionsCliError, sessionsCliResponseText } from './sessions-cli-output'

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
 * The CLI error envelope, `{schemaVersion, type: "error", error: {kind, message}}`, with an
 * additive `savedChannel` once the Session Host has reported it. A failed release check then still
 * tells `install.sh` the channel to keep, instead of looking like an install with no channel.
 */
export function writeUpdateCheckError(
  error: unknown,
  savedChannel: UpdateChannel,
  stderr: (value: string) => unknown = (value) => process.stderr.write(value),
) {
  const kind = classifySessionsCliError(error)
  const message = error instanceof Error ? error.message : String(error)
  stderr(
    `${JSON.stringify({
      schemaVersion: SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
      type: 'error',
      error: { kind, message },
      savedChannel,
    })}\n`,
  )
  return kind
}
