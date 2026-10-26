import { app } from 'electron'
import { CLI_EXIT, CliError } from './cli-error'
import { writeCliStdout } from './cli-stdout'
import { CommandCliUsageError } from './command-cli-option-contract'
import { isDesktopAppRunning } from './desktop-instance-probe'
import { stopHostForUpdate } from './host-cli'
import { formatHostUpdateStopReport } from './host-update-stop'
import type { ParsedArguments } from './mcp-cli-arguments'
import {
  prepareWindowsInstaller,
  releaseForTag,
  runBundledInstaller,
} from './update-cli-installers'
import { compareReleaseVersions } from './update-feed'

export const EXIT = CLI_EXIT
const RELEASE_TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u

/** A refusal caused by the command line itself; `openwaggle update` exits with status 2. */
export class UpdateCliUsageError extends CommandCliUsageError {}

export function normalizeVersion(value: string) {
  const tag = value.startsWith('v') ? value : `v${value}`
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new UpdateCliUsageError(`Invalid OpenWaggle version ${JSON.stringify(value)}.`)
  }
  return tag
}

const DESKTOP_OPEN_EXACT_VERSION_MESSAGE =
  'OpenWaggle is open. Quit it first so its active agent runs are not interrupted, then run this command again.'

/**
 * Stop the Session Host before the installer replaces the app, as Restart to update does (ADR
 * 0047): active Runs are waited for, stopped, or the update is cancelled. On macOS and for an exact
 * Linux version the bundled install script does this itself.
 */
export async function stopSessionHostBeforeInstall(parsed: ParsedArguments) {
  const report = await stopHostForUpdate(parsed)
  // The state refuses the install, as `host stop --update` exits 6 for it (#351).
  if (report.state === 'cancelled') {
    throw new CliError('conflict', 'Update cancelled. OpenWaggle was not changed.')
  }
  if (report.state === 'desktop-open')
    throw new CliError('conflict', DESKTOP_OPEN_EXACT_VERSION_MESSAGE)
  // The Windows installer closes what is left, and an AppImage is replaced as one file.
  if (report.state === 'timed-out' || report.state === 'refused' || report.state === 'replaced') {
    process.stderr.write(`${formatHostUpdateStopReport(report)}\n`)
  }
}

/**
 * Downgrades are unsupported (docs/release-and-versioning.md): an older version may not open data
 * that a newer one has migrated, so an exact version may reinstall the installed one but never go
 * below it.
 */
function refuseDowngrade(tag: string) {
  const installed = app.getVersion()
  const order = compareReleaseVersions(tag, installed)
  if (order === undefined) {
    throw new UpdateCliUsageError(
      `OpenWaggle cannot compare ${tag} with the installed version ${installed}, so it does not install it.`,
    )
  }
  if (order < 0) {
    throw new UpdateCliUsageError(
      `OpenWaggle ${tag} is older than the installed ${installed}. Downgrades are unsupported: an ` +
        'older version may not open the data this version has already migrated.',
    )
  }
}

export async function installExactVersion(
  parsed: ParsedArguments,
  tag: string,
  checkOnly: boolean,
) {
  refuseDowngrade(tag)
  const release = await releaseForTag(tag)
  if (checkOnly) {
    await writeCliStdout(`OpenWaggle ${release.tag_name} is available.\n`)
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  // Installing over a running app would stop its active agent runs without asking.
  if (isDesktopAppRunning(app)) throw new CliError('conflict', DESKTOP_OPEN_EXACT_VERSION_MESSAGE)
  if (process.platform === 'win32') {
    const installer = await prepareWindowsInstaller(tag)
    await stopSessionHostBeforeInstall(parsed).catch(async (error: unknown) => {
      await installer.discard()
      throw error
    })
    await installer.launch()
    await writeCliStdout(`Installing OpenWaggle ${release.tag_name}…\n`)
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  const exitCode = await runBundledInstaller(tag)
  return { exitCode, updaterOwnsExit: false }
}
