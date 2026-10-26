import { LOCAL_UPDATE_CONTRACT_VERSION } from '@shared/types/local-update'
import {
  UPDATE_CHANNELS,
  type UpdateChannel,
  updaterFeedChannel,
} from '@shared/types/update-channel'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { CliError, cliExitCodeForKind } from './cli-error'
import { writeCliStdout } from './cli-stdout'
import { isDesktopAppRunning } from './desktop-instance-probe'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, option, type ParsedArguments, parseMcpCliArguments } from './mcp-cli-arguments'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { writeSessionsCliError } from './sessions-cli-output'
import {
  EXIT,
  installExactVersion,
  normalizeVersion,
  stopSessionHostBeforeInstall,
  UpdateCliUsageError,
} from './update-cli-exact-version'
import { runBundledInstaller } from './update-cli-installers'
import {
  configureUpdaterFeed,
  isVersionEligibleForChannel,
  type UpdateFeedSelection,
} from './update-feed'

const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000

function usage() {
  return `OpenWaggle update

Usage:
  openwaggle update [--channel stable|beta|alpha] [--check]
  openwaggle update --version <version> [--check]

The selected channel is shared with the desktop app. --check only reports: it never changes the
saved channel, even with --channel. An exact version is a one-time install, does not change the
saved channel, and cannot be older than the installed version: downgrades are unsupported.`
}

function validateArguments(args: ReturnType<typeof parseMcpCliArguments>) {
  if (args.positionals.length > 0 || args.passthrough.length > 0) {
    throw new UpdateCliUsageError('OpenWaggle update received unexpected positional arguments.')
  }
  const known = new Set(['channel', 'version', 'check', 'help'])
  const unknown = [...args.options.keys()].filter((name) => !known.has(name))
  if (unknown.length > 0) {
    throw new UpdateCliUsageError(`Unknown option for OpenWaggle update: --${unknown[0]}.`)
  }
  for (const name of ['channel', 'version']) {
    if (option(args, name) === 'true') {
      throw new UpdateCliUsageError(`Missing value for --${name}.`)
    }
  }
  for (const name of ['check', 'help']) {
    const value = option(args, name)
    if (value !== undefined && value !== 'true') {
      throw new UpdateCliUsageError(`--${name} does not accept values.`)
    }
  }
  if (args.options.has('channel') && args.options.has('version')) {
    throw new UpdateCliUsageError('--channel and --version cannot be used together.')
  }
}

function parseChannel(value: string | undefined): UpdateChannel | undefined {
  if (value === undefined) return undefined
  const channel = UPDATE_CHANNELS.find((candidate) => candidate === value)
  if (!channel) {
    throw new UpdateCliUsageError(`Unsupported update channel ${JSON.stringify(value)}.`)
  }
  return channel
}

async function configureUpdater(
  channel: UpdateChannel,
  checkOnly: boolean,
): Promise<UpdateFeedSelection> {
  autoUpdater.channel = updaterFeedChannel(channel)
  autoUpdater.allowPrerelease = channel !== 'stable'
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = !checkOnly
  // Installs only through quitAndInstall below. Installing on quit would let a Ctrl-C while the
  // Session Host stops install the update under it.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null
  return configureUpdaterFeed(autoUpdater, channel)
}

function createDownloadWaiter() {
  let cancel = () => undefined
  const promise = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      autoUpdater.off('update-downloaded', downloaded)
      autoUpdater.off('error', failed)
      if (error) reject(error)
      else resolve()
    }
    const downloaded = () => finish()
    const failed = (error: Error) => finish(error)
    cancel = () => {
      clearTimeout(timeout)
      autoUpdater.off('update-downloaded', downloaded)
      autoUpdater.off('error', failed)
    }
    autoUpdater.once('update-downloaded', downloaded)
    autoUpdater.once('error', failed)
    const timeout = setTimeout(
      () => finish(new CliError('timeout', 'Timed out while downloading the update.')),
      DOWNLOAD_TIMEOUT_MS,
    )
  })
  return { promise, cancel }
}

function abandonDownloadWaiter(waiter: ReturnType<typeof createDownloadWaiter> | null) {
  if (!waiter) return
  waiter.cancel()
  void waiter.promise.catch(() => undefined)
}

type ChannelInstallMode = 'check' | 'defer-to-desktop' | 'bundled-installer' | 'updater'

function channelInstallMode(checkOnly: boolean): ChannelInstallMode {
  if (checkOnly) return 'check'
  // A running desktop app owns installation, so its Restart to update action can protect active
  // agent runs and relaunch it. The terminal then only reports the available version.
  if (isDesktopAppRunning(app)) return 'defer-to-desktop'
  // Squirrel.Mac ignores quitAndInstall's arguments and always relaunches the app, so macOS installs
  // through the bundled installer, which can install without opening a window.
  return process.platform === 'darwin' ? 'bundled-installer' : 'updater'
}

async function installAvailableUpdate(input: {
  readonly mode: ChannelInstallMode
  readonly version: string
  readonly channel: UpdateChannel
  readonly downloaded: ReturnType<typeof createDownloadWaiter> | null
  readonly parsed: ParsedArguments
  readonly unsavedChannel: boolean
}) {
  const { mode, version, channel } = input
  if (mode === 'check') {
    await writeCliStdout(
      `OpenWaggle ${version} is available on the ${channel} channel.` +
        `${input.unsavedChannel ? ' The saved update channel was not changed.' : ''}\n`,
    )
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  if (mode === 'defer-to-desktop') {
    autoUpdater.autoInstallOnAppQuit = false
    await writeCliStdout(
      `OpenWaggle ${version} is available on the ${channel} channel. OpenWaggle is open, so install ` +
        'it from the app: Settings > General > About & Updates > Check now, then Restart to update.\n',
    )
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  if (mode === 'bundled-installer') {
    await writeCliStdout(`Installing OpenWaggle ${version} from the ${channel} channel…\n`)
    return { exitCode: await runBundledInstaller(`v${version}`), updaterOwnsExit: false }
  }
  await writeCliStdout(`Downloading OpenWaggle ${version} from the ${channel} channel…\n`)
  await input.downloaded?.promise
  await stopSessionHostBeforeInstall(input.parsed)
  await writeCliStdout(`Installing OpenWaggle ${version}…\n`)
  // Windows and Linux honor this: install silently without opening a window.
  autoUpdater.quitAndInstall(true, false)
  return { exitCode: EXIT.SUCCESS, updaterOwnsExit: true }
}

async function updateFromChannel(input: {
  readonly parsed: ParsedArguments
  readonly channel: UpdateChannel
  readonly checkOnly: boolean
  readonly unsavedChannel: boolean
}) {
  const { parsed, channel, unsavedChannel } = input
  const mode = channelInstallMode(input.checkOnly)
  const reportOnly = mode !== 'updater'
  const selection = await configureUpdater(channel, reportOnly)
  if (selection.type === 'no-release') {
    // Stable before 1.0.0, or a release whose update metadata is still uploading.
    await writeCliStdout(
      `OpenWaggle is up to date on the ${channel} channel: no release is available on it yet.` +
        `${unsavedChannel ? ' The saved update channel was not changed.' : ''}\n`,
    )
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  const downloaded = reportOnly ? null : createDownloadWaiter()
  const result = await autoUpdater.checkForUpdates().catch((error: unknown) => {
    abandonDownloadWaiter(downloaded)
    throw error
  })
  if (!result?.isUpdateAvailable) {
    abandonDownloadWaiter(downloaded)
    await writeCliStdout(`OpenWaggle is up to date on the ${channel} channel.\n`)
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  const version = result.updateInfo.version
  if (!isVersionEligibleForChannel(version, channel)) {
    abandonDownloadWaiter(downloaded)
    autoUpdater.autoInstallOnAppQuit = false
    result.cancellationToken?.cancel()
    void result.downloadPromise?.catch(() => undefined)
    throw new Error(`OpenWaggle ${version} is not eligible for the ${channel} update channel.`)
  }
  return installAvailableUpdate({ mode, version, channel, downloaded, parsed, unsavedChannel })
}

async function readAndUpdateChannel(
  parsed: ReturnType<typeof parseMcpCliArguments>,
  requested: UpdateChannel | undefined,
) {
  // The command offers the revisions it can be sent at (`supportedRevisionsForCommand`): a Host
  // accepts only its current one, so pinning the revision that introduced it failed the handshake.
  const client = await createLocalSessionCliClientInput(parsed, {
    agentRefusal:
      'OpenWaggle agents cannot check for or install OpenWaggle updates. Ask the user to run openwaggle update.',
  })
  const result = await executeLocalSessionCommand({
    ...client,
    payload: requested
      ? {
          contract: 'local-update-v1',
          request: {
            contractVersion: LOCAL_UPDATE_CONTRACT_VERSION,
            operation: 'set-channel',
            channel: requested,
          },
        }
      : {
          contract: 'local-update-v1',
          request: {
            contractVersion: LOCAL_UPDATE_CONTRACT_VERSION,
            operation: 'get-channel',
          },
        },
  })
  if (result.contract !== 'local-update-v1') {
    throw new Error('Session Host returned a mismatched update channel response.')
  }
  return result.response.updateChannel
}

export async function runUpdateCli(args: readonly string[]) {
  try {
    const parsed = parseMcpCliArguments(args)
    validateArguments(parsed)
    if (hasFlag(parsed, 'help')) {
      await writeCliStdout(`${usage()}\n`)
      return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
    }
    const version = option(parsed, 'version')
    if (version)
      return await installExactVersion(parsed, normalizeVersion(version), hasFlag(parsed, 'check'))
    const requested = parseChannel(option(parsed, 'channel'))
    const checkOnly = hasFlag(parsed, 'check')
    // --check is read-only: it checks a requested channel without saving it.
    if (checkOnly && requested) {
      return await updateFromChannel({
        parsed,
        channel: requested,
        checkOnly,
        unsavedChannel: true,
      })
    }
    const channel = await readAndUpdateChannel(parsed, requested)
    return await updateFromChannel({ parsed, channel, checkOnly, unsavedChannel: false })
  } catch (error) {
    // `update` has no --json; it reports like every CLI, with the kind (#351).
    return {
      exitCode: cliExitCodeForKind(writeSessionsCliError(error, false)),
      updaterOwnsExit: false,
    }
  }
}
