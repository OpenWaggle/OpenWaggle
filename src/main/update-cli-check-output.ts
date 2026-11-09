import type { UpdateChannel } from '@shared/types/update-channel'
import { CLI_EXIT } from './cli-error'
import { writeCliStdout } from './cli-stdout'
import { sessionsCliResponseText } from './sessions-cli-output'

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

/** Set for `--check --json`: reads the saved channel only when a result is printed. */
export interface UpdateCheckMachineOutput {
  readonly savedChannel: () => Promise<UpdateChannel>
}

export async function writeUpdateCheckResult(result: UpdateCheckResult) {
  await writeCliStdout(sessionsCliResponseText('update', result, true))
  return { exitCode: CLI_EXIT.SUCCESS, updaterOwnsExit: false }
}
