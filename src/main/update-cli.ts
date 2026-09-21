import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { LOCAL_UPDATE_CONTRACT_VERSION } from '@shared/types/local-update'
import {
  UPDATE_CHANNELS,
  type UpdateChannel,
  updaterFeedChannel,
} from '@shared/types/update-channel'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { writeCliStdout } from './cli-stdout'
import { launchExternalApplication } from './desktop-ui'
import { getEnvWithOverrides } from './env'
import { createLocalSessionCliClientInput } from './local-session-cli-client'
import { hasFlag, option, parseMcpCliArguments } from './mcp-cli-arguments'
import { executeLocalSessionCommand } from './session-host/local-session-client'
import { configureUpdaterFeed } from './update-feed'

const EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2 } as const
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000
const WINDOWS_INSTALLER_MODE = 0o700
const RELEASE_TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/u
const releaseSchema = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(Schema.Struct({ name: Schema.String, browser_download_url: Schema.String })),
})

class UpdateCliUsageError extends Error {}

function usage() {
  return `OpenWaggle update

Usage:
  openwaggle update [--channel stable|beta|alpha] [--check]
  openwaggle update --version <version> [--check]

The selected channel is shared with the desktop app. An exact version is a one-time install
and does not change the saved channel.`
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

function normalizeVersion(value: string) {
  const tag = value.startsWith('v') ? value : `v${value}`
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new UpdateCliUsageError(`Invalid OpenWaggle version ${JSON.stringify(value)}.`)
  }
  return tag
}

async function releaseForTag(tag: string) {
  const response = await fetch(
    `https://api.github.com/repos/OpenWaggle/OpenWaggle/releases/tags/${encodeURIComponent(tag)}`,
    { headers: { accept: 'application/vnd.github+json' } },
  )
  if (!response.ok) throw new Error(`OpenWaggle release ${tag} was not found.`)
  return decodeUnknownOrThrow(releaseSchema, await response.json())
}

async function runBundledInstaller(tag: string) {
  const installerPath = app.isPackaged
    ? path.join(process.resourcesPath, 'openwaggle-install.sh')
    : path.join(app.getAppPath(), 'scripts', 'install.sh')
  return await new Promise<number>((resolve, reject) => {
    const child = spawn('bash', [installerPath], {
      stdio: 'inherit',
      env: getEnvWithOverrides({ OPENWAGGLE_RELEASE_TAG: tag }),
    })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? EXIT.FAILURE))
  })
}

async function download(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`)
  return Buffer.from(await response.arrayBuffer())
}

async function runWindowsInstaller(tag: string) {
  const release = await releaseForTag(tag)
  const installer = release.assets.find((asset) => /-x64\.exe$/u.test(asset.name))
  const checksums = release.assets.find((asset) => asset.name === 'SHA256SUMS.txt')
  if (!installer || !checksums)
    throw new Error(`Release ${tag} is missing Windows verification assets.`)
  const [contents, checksumContents] = await Promise.all([
    download(installer.browser_download_url),
    download(checksums.browser_download_url),
  ])
  const expected = checksumContents
    .toString('utf8')
    .split('\n')
    .find((line) => line.trimEnd().endsWith(` ${installer.name}`))
    ?.trim()
    .split(/\s+/u)[0]
  const actual = createHash('sha256').update(contents).digest('hex')
  if (!expected || expected !== actual)
    throw new Error(`Release ${tag} failed checksum verification.`)
  const destination = path.join(tmpdir(), `openwaggle-update-${randomUUID()}.exe`)
  await writeFile(destination, contents, { mode: WINDOWS_INSTALLER_MODE })
  await launchExternalApplication(destination, ['/S'])
}

async function installExactVersion(tag: string, checkOnly: boolean) {
  const release = await releaseForTag(tag)
  if (checkOnly) {
    await writeCliStdout(`OpenWaggle ${release.tag_name} is available.\n`)
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  if (process.platform === 'win32') {
    await runWindowsInstaller(tag)
    await writeCliStdout(`Installing OpenWaggle ${release.tag_name}…\n`)
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  const exitCode = await runBundledInstaller(tag)
  return { exitCode, updaterOwnsExit: false }
}

async function configureUpdater(channel: UpdateChannel, checkOnly: boolean) {
  autoUpdater.channel = updaterFeedChannel(channel)
  autoUpdater.allowPrerelease = channel !== 'stable'
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = !checkOnly
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  await configureUpdaterFeed(autoUpdater, channel)
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
      () => finish(new Error('Timed out while downloading the update.')),
      DOWNLOAD_TIMEOUT_MS,
    )
  })
  return { promise, cancel }
}

async function updateFromChannel(channel: UpdateChannel, checkOnly: boolean) {
  await configureUpdater(channel, checkOnly)
  const downloaded = checkOnly ? null : createDownloadWaiter()
  const result = await autoUpdater.checkForUpdates().catch((error: unknown) => {
    downloaded?.cancel()
    throw error
  })
  if (!result?.isUpdateAvailable) {
    downloaded?.cancel()
    await writeCliStdout(`OpenWaggle is up to date on the ${channel} channel.\n`)
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  const version = result.updateInfo.version
  if (checkOnly) {
    await writeCliStdout(`OpenWaggle ${version} is available on the ${channel} channel.\n`)
    return { exitCode: EXIT.SUCCESS, updaterOwnsExit: false }
  }
  await writeCliStdout(`Downloading OpenWaggle ${version} from the ${channel} channel…\n`)
  await downloaded?.promise
  await writeCliStdout(`Installing OpenWaggle ${version}…\n`)
  autoUpdater.quitAndInstall(false, true)
  return { exitCode: EXIT.SUCCESS, updaterOwnsExit: true }
}

async function readAndUpdateChannel(
  parsed: ReturnType<typeof parseMcpCliArguments>,
  requested: UpdateChannel | undefined,
) {
  const client = await createLocalSessionCliClientInput(parsed)
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
      return await installExactVersion(normalizeVersion(version), hasFlag(parsed, 'check'))
    const channel = await readAndUpdateChannel(parsed, parseChannel(option(parsed, 'channel')))
    return await updateFromChannel(channel, hasFlag(parsed, 'check'))
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return {
      exitCode: error instanceof UpdateCliUsageError ? EXIT.USAGE : EXIT.FAILURE,
      updaterOwnsExit: false,
    }
  }
}
