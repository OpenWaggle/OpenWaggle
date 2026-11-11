import { LOCAL_UPDATE_CONTRACT_VERSION } from '@shared/types/local-update'
import { type UpdateChannel, updaterFeedChannel } from '@shared/types/update-channel'
import { CliError, cliExitCodeForKind } from './cli-error'
import { writeCliStdout } from './cli-stdout'
import { systemIntegration } from './desktop-shell/system-integration'
import { updateEngine } from './desktop-shell/update-engine'
import { isDesktopAppRunning } from './desktop-instance-probe'
import {
  assertCliAgentMayUseOwnerAuthority,
  createLocalSessionCliClientInput,
} from './local-session-cli-client'
import { hasFlag, option, type ParsedArguments, parseMcpCliArguments } from './mcp-cli-arguments'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { writeSessionsCliError } from './sessions-cli-output'
import { parseChannel, usage, validateArguments } from './update-cli-arguments'
import {
  type UpdateCheckMachineOutput,
  withinUpdateCheckDeadline,
  writeUpdateCheckError,
  writeUpdateCheckResult,
} from './update-cli-check-output'
import {
  EXIT,
  installExactVersion,
  normalizeVersion,
  stopSessionHostBeforeInstall,
} from './update-cli-exact-version'
import { runBundledInstaller } from './update-cli-installers'
import { configureUpdaterFeed, isVersionEligibleForChannel } from './update-feed'

const UPDATE_AGENT_REFUSAL =
  'OpenWaggle agents cannot check for or install OpenWaggle updates. Ask the user to run openwaggle update.'
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000

async function configureUpdater(channel: UpdateChannel, checkOnly: boolean) {
  updateEngine.configure({
    feedChannel: updaterFeedChannel(channel),
    allowPrerelease: channel !== 'stable',
  })
  updateEngine.setAutoDownload(!checkOnly)
  // Installs only through quitAndInstall below. Installing on quit would let a Ctrl-C while the
  // Session Host stops install the update under it.
  updateEngine.cancelInstallOnQuit()
  return configureUpdaterFeed(updateEngine, channel)
}

function createDownloadWaiter() {
  let cancel = () => undefined
  const promise = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      cancel()
      if (error) reject(error)
      else resolve()
    }
    const stopDownloaded = updateEngine.onUpdateDownloaded(() => finish())
    const stopFailed = updateEngine.onError((error) => finish(error))
    cancel = () => {
      clearTimeout(timeout)
      stopDownloaded()
      stopFailed()
    }
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

function channelInstallMode(checkOnly: boolean) {
  if (checkOnly) return 'check' as const
  // A running desktop app owns installation, so its Restart to update action can protect active
  // agent runs and relaunch it. The terminal then only reports the available version.
  if (isDesktopAppRunning(systemIntegration)) return 'defer-to-desktop' as const
  // On macOS the engine always relaunches the app after it installs (Squirrel.Mac before the
  // Electrobun transition, Electrobun's updater after it), so macOS installs through the bundled
  // installer, which can install without opening a window.
  return process.platform === 'darwin' ? ('bundled-installer' as const) : ('updater' as const)
}

async function installAvailableUpdate(input: {
  readonly mode: ChannelInstallMode
  readonly version: string
  readonly channel: UpdateChannel
  readonly downloaded: ReturnType<typeof createDownloadWaiter> | null
  readonly parsed: ParsedArguments
  readonly unsavedChannel: boolean
  readonly machine: UpdateCheckMachineOutput | null
}) {
  const { mode, version, channel } = input
  if (mode === 'check' && input.machine) {
    const { savedChannel } = input.machine
    return writeUpdateCheckResult({ savedChannel, channel, status: 'available', version })
  }
  if (mode === 'check') {
    await writeCliStdout(
      `OpenWaggle ${version} is available on the ${channel} channel.` +
        `${input.unsavedChannel ? ' The saved update channel was not changed.' : ''}\n`,
    )
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  if (mode === 'defer-to-desktop') {
    updateEngine.cancelInstallOnQuit()
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
  updateEngine.quitAndInstall({ silent: true, relaunch: false })
  return { exitCode: EXIT.SUCCESS, updaterOwnsExit: true }
}

async function updateFromChannel(input: {
  readonly parsed: ParsedArguments
  readonly channel: UpdateChannel
  readonly checkOnly: boolean
  readonly unsavedChannel: boolean
  readonly machine: UpdateCheckMachineOutput | null
}) {
  const { parsed, channel, unsavedChannel, machine } = input
  const mode = channelInstallMode(input.checkOnly)
  const reportOnly = mode !== 'updater'
  const selection = await configureUpdater(channel, reportOnly)
  if (selection.type === 'no-release' && machine) {
    const { savedChannel } = machine
    return writeUpdateCheckResult({ savedChannel, channel, status: 'no-release' })
  }
  if (selection.type === 'no-release') {
    // Stable before 1.0.0, or a release whose update metadata is still uploading.
    await writeCliStdout(
      `OpenWaggle is up to date on the ${channel} channel: no release is available on it yet.` +
        `${unsavedChannel ? ' The saved update channel was not changed.' : ''}\n`,
    )
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  const downloaded = reportOnly ? null : createDownloadWaiter()
  const result = await updateEngine.checkForUpdates().catch((error: unknown) => {
    abandonDownloadWaiter(downloaded)
    throw error
  })
  if (!result) {
    abandonDownloadWaiter(downloaded)
    if (machine) {
      const { savedChannel } = machine
      return writeUpdateCheckResult({ savedChannel, channel, status: 'up-to-date' })
    }
    await writeCliStdout(`OpenWaggle is up to date on the ${channel} channel.\n`)
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  const version = result.version
  if (!isVersionEligibleForChannel(version, channel)) {
    abandonDownloadWaiter(downloaded)
    updateEngine.cancelInstallOnQuit()
    result.cancelDownload()
    void result.download?.catch(() => undefined)
    throw new Error(`OpenWaggle ${version} is not eligible for the ${channel} update channel.`)
  }
  return installAvailableUpdate({
    mode,
    version,
    channel,
    downloaded,
    parsed,
    unsavedChannel,
    machine,
  })
}

async function readAndUpdateChannel(
  parsed: ReturnType<typeof parseMcpCliArguments>,
  requested: UpdateChannel | undefined,
) {
  // The command offers the revisions it can be sent at (`supportedRevisionsForCommand`): a Host
  // accepts only its current one, so pinning the revision that introduced it failed the handshake.
  const client = await createLocalSessionCliClientInput(parsed, {
    agentRefusal: UPDATE_AGENT_REFUSAL,
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

async function dispatchUpdate(input: {
  readonly parsed: ParsedArguments
  readonly checkOnly: boolean
  readonly savedChannel: UpdateChannel | undefined
  readonly machine: UpdateCheckMachineOutput | null
}) {
  const { parsed, checkOnly, machine } = input
  const version = option(parsed, 'version')
  if (version) {
    return installExactVersion(parsed, normalizeVersion(version), checkOnly, { machine })
  }
  const requested = parseChannel(option(parsed, 'channel'))
  // --check is read-only: it checks a requested channel without saving it.
  if (checkOnly && requested) {
    return updateFromChannel({
      parsed,
      channel: requested,
      checkOnly,
      unsavedChannel: true,
      machine,
    })
  }
  const channel = input.savedChannel ?? (await readAndUpdateChannel(parsed, requested))
  return updateFromChannel({ parsed, channel, checkOnly, unsavedChannel: false, machine })
}

export async function runUpdateCli(args: readonly string[]) {
  let json = false
  let savedChannel: UpdateChannel | undefined
  try {
    const parsed = parseMcpCliArguments(args)
    json = hasFlag(parsed, 'json')
    validateArguments(parsed)
    if (hasFlag(parsed, 'help')) {
      await writeCliStdout(`${usage()}\n`)
      return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
    }
    // Every path, the Host-free ones included: an agent Run neither checks nor installs (#351).
    assertCliAgentMayUseOwnerAuthority(UPDATE_AGENT_REFUSAL)
    const checkOnly = hasFlag(parsed, 'check')
    // --check --json reads the saved channel first, with `get-channel`, which only reads: even a
    // failed release check still reports it, so install.sh never mistakes a feed error for no channel.
    if (json) savedChannel = await readAndUpdateChannel(parsed, undefined)
    const machine = savedChannel ? { savedChannel } : null
    const update = dispatchUpdate({ parsed, checkOnly, savedChannel, machine })
    return await (machine ? withinUpdateCheckDeadline(update) : update)
  } catch (error) {
    // Every CLI reports a failure with its kind, as an error envelope with --json (#351).
    const kind =
      json && savedChannel
        ? writeUpdateCheckError(error, savedChannel)
        : writeSessionsCliError(error, json)
    return { exitCode: cliExitCodeForKind(kind), updaterOwnsExit: false }
  }
}
