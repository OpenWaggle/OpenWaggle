import type { UpdateStatusEntry } from 'electrobun/main'
import type { Unsubscribe } from '../../ports/desktop-shell/shell-events'
import type {
  UpdateEngineShape,
  UpdateMetadataTarget,
} from '../../ports/desktop-shell/update-engine'
import { electrobun } from './electrobun-sdk'
import { emitShellEvent } from './electrobun-shell-events'

/**
 * Electrobun's updater as OpenWaggle's UpdateEngine (ADR 0064). OpenWaggle's update policy keeps
 * choosing the release a channel follows (src/main/update-feed.ts lists the GitHub releases and
 * hands over that release's download directory); this engine points Electrobun's updater at it.
 * Every release is built with Electrobun's `stable` build environment and publishes
 * `stable-<os>-<arch>-update-v2.json`, its `.tar.zst` and the delta patch from the previous release
 * on the channel, so Stable, Beta and Alpha all read immutable, already verified releases and need
 * no rolling release or other host (docs/release-and-versioning.md, "Electrobun updates").
 *
 * Electrobun differs from electron-updater in ways this adapter absorbs:
 * - Its base URL is baked into `Resources/version.json`; `Updater.getLocalInfo()` returns the one
 *   object every later check, download and install reads, so the feed is set on it, and read back
 *   to fail loudly if a newer Electrobun stops honoring it.
 * - It offers whatever release has a different bundle hash, older ones included, so the engine only
 *   reports a newer version, and a prerelease only when the channel allows prereleases.
 * - It reports through one status callback; the engine fans it out to its listeners.
 * - It never installs on quit, and its install always runs silently and relaunches the app; the
 *   engine announces `before-quit-for-update` to the other adapters before it starts one.
 * - The SDK is reached through `electrobun()` when a member runs, never at import (it loads only in
 *   the desktop app, electrobun-sdk.ts).
 * - A native preparation cannot be stopped once started; cancelling a check only stops a download
 *   that has not started, and ignores the result of one that has.
 */

type Listener<Value> = (value: Value) => void

interface EngineState {
  subscribed: boolean
  allowPrerelease: boolean
  autoDownload: boolean
  /** The feed OpenWaggle chose; `null` keeps the one baked into the build. */
  baseUrl: string | null
  /** The installed version, known after the first check. */
  localVersion: string | null
  /** Versions whose download a caller cancelled; their completion is not reported. */
  readonly cancelled: Set<string>
}

/**
 * The build environment every release is built with (docs/electrobun-transition.md); Electrobun
 * prefixes the update files with it, whatever OpenWaggle channel the release is on.
 */
const BUILD_ENVIRONMENT = 'stable'
/** Electrobun's names for the platforms (`SupportedOS` in its shared/platform.ts). */
const ELECTROBUN_OS: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  darwin: 'macos',
  win32: 'win',
  linux: 'linux',
}

/**
 * `stable-<os>-<arch>-update-v2.json`: the manifest Electrobun's updater reads first (it falls back
 * to `-update.json` only when this one is missing; OpenWaggle releases publish both).
 */
export function electrobunMetadataAssetName({ platform, arch }: UpdateMetadataTarget) {
  const os = ELECTROBUN_OS[platform]
  if (os === undefined) throw new Error(`Electrobun publishes no updates for ${platform}.`)
  return `${BUILD_ENVIRONMENT}-${os}-${arch}-update-v2.json`
}
const SEMVER_CORE_PARTS = 3
const PRERELEASE_SEPARATOR = '-'
const BUILD_METADATA_SEPARATOR = '+'
const NUMERIC_IDENTIFIER = /^\d+$/u

function createListeners<Value>() {
  const listeners = new Set<Listener<Value>>()
  return {
    add(listener: Listener<Value>): Unsubscribe {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(value: Value) {
      for (const listener of [...listeners]) listener(value)
    },
  }
}

function parseVersion(version: string) {
  const withoutBuild = version.trim().replace(/^v/u, '').split(BUILD_METADATA_SEPARATOR)[0] ?? ''
  const separator = withoutBuild.indexOf(PRERELEASE_SEPARATOR)
  const core = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator)
  const prerelease = separator === -1 ? [] : withoutBuild.slice(separator + 1).split('.')
  const numbers = core.split('.').map(Number)
  if (
    numbers.length !== SEMVER_CORE_PARTS ||
    numbers.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return null
  }
  return { numbers, prerelease }
}

function compareIdentifiers(left: string, right: string) {
  const leftNumeric = NUMERIC_IDENTIFIER.test(left)
  const rightNumeric = NUMERIC_IDENTIFIER.test(right)
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Semantic-version precedence: negative when `left` is older; `null` for a non-version. */
export function compareSemanticVersions(left: string, right: string) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return null
  for (let index = 0; index < a.numbers.length; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const difference = compareIdentifiers(leftPart, rightPart)
    if (difference !== 0) return difference
  }
  return 0
}

const updater = () => electrobun().Updater

function createEngineListeners() {
  return {
    checking: createListeners<undefined>(),
    available: createListeners<string>(),
    notAvailable: createListeners<undefined>(),
    progress: createListeners<number>(),
    downloaded: createListeners<string>(),
    failed: createListeners<Error>(),
  }
}

type EngineListeners = ReturnType<typeof createEngineListeners>

interface StatusContext {
  readonly listeners: EngineListeners
  readonly state: EngineState
  /** The update Electrobun reports on, and whether the engine offers it. */
  readonly version: string
  readonly offered: boolean
}

type StatusHandler = (entry: UpdateStatusEntry, context: StatusContext) => void

/** What each Electrobun status means for the port's events; other statuses are progress detail. */
const STATUS_HANDLERS: Readonly<Partial<Record<UpdateStatusEntry['status'], StatusHandler>>> = {
  checking: (_entry, { listeners }) => listeners.checking.emit(undefined),
  'update-available': (_entry, { listeners, version, offered }) => {
    if (offered) listeners.available.emit(version)
    else listeners.notAvailable.emit(undefined)
  },
  'no-update': (_entry, { listeners }) => listeners.notAvailable.emit(undefined),
  'download-progress': (entry, { listeners }) =>
    listeners.progress.emit(entry.details?.progress ?? 0),
  'download-complete': (_entry, { listeners, state, version, offered }) => {
    if (offered && !state.cancelled.has(version)) listeners.downloaded.emit(version)
  },
  error: (entry, { listeners }) => listeners.failed.emit(new Error(entry.message)),
}

function createElectrobunUpdateEngine(): UpdateEngineShape {
  const listeners = createEngineListeners()
  const { checking, available, notAvailable, progress, downloaded, failed } = listeners
  const state: EngineState = {
    subscribed: false,
    allowPrerelease: false,
    autoDownload: true,
    baseUrl: null,
    localVersion: null,
    cancelled: new Set(),
  }

  /** A newer version the channel accepts. Before the first check the installed version is unknown. */
  function offersUpdate(version: string) {
    if (state.localVersion === null) return true
    const newer = compareSemanticVersions(version, state.localVersion)
    if (newer === null || newer <= 0) return false
    return state.allowPrerelease || !version.includes(PRERELEASE_SEPARATOR)
  }

  function onStatus(entry: UpdateStatusEntry) {
    const version = updater().updateInfo().version
    STATUS_HANDLERS[entry.status]?.(entry, {
      listeners,
      state,
      version,
      offered: offersUpdate(version),
    })
  }

  function subscribe() {
    if (state.subscribed) return
    state.subscribed = true
    updater().onStatusChange(onStatus)
  }

  function listen<Value>(listeners: ReturnType<typeof createListeners<Value>>) {
    return (listener: Listener<Value>) => {
      subscribe()
      return listeners.add(listener)
    }
  }

  /** Points Electrobun at the chosen feed and refuses to check anything else. */
  async function applyFeed() {
    const info = await updater().getLocalInfo()
    state.localVersion = info.version
    if (state.baseUrl === null) return
    info.baseUrl = state.baseUrl
    const effective = await updater().localInfo.baseUrl()
    if (effective !== state.baseUrl) {
      throw new Error(
        `Electrobun's updater reads ${effective}, not the selected feed ${state.baseUrl}.`,
      )
    }
  }

  function startDownload(version: string) {
    const download = new Promise<void>((resolve) => {
      // One task later, so a caller that cancels right after the check stops it before it starts.
      setTimeout(resolve, 0)
    }).then(async () => {
      if (state.cancelled.has(version)) return
      await updater().downloadUpdate()
      const result = updater().updateInfo()
      if (!state.cancelled.has(version) && !result.updateReady) {
        throw new Error(result.error === '' ? `Update ${version} was not prepared.` : result.error)
      }
    })
    return download
  }

  return {
    configure: ({ allowPrerelease }) => {
      // Electrobun names the update metadata after the build environment, not OpenWaggle's
      // channel: the channel already chose the release (setFeed).
      state.allowPrerelease = allowPrerelease
    },
    setAutoDownload: (autoDownload) => {
      state.autoDownload = autoDownload
    },
    metadataAssetName: electrobunMetadataAssetName,
    setFeed: (feed) => {
      state.baseUrl = feed.releaseUrl
    },
    cancelInstallOnQuit: () => undefined,
    checkForUpdates: async () => {
      subscribe()
      await applyFeed()
      const result = await updater().checkForUpdate()
      if (result.error !== '') throw new Error(result.error)
      if (!result.updateAvailable || !offersUpdate(result.version)) return null
      const { version } = result
      state.cancelled.delete(version)
      return {
        version,
        download: state.autoDownload ? startDownload(version) : null,
        cancelDownload: () => {
          state.cancelled.add(version)
        },
      }
    },
    // Electrobun's install is always silent and always starts the new version.
    quitAndInstall: () => {
      subscribe()
      emitShellEvent('before-quit-for-update')
      updater()
        .applyUpdate()
        .catch((error: unknown) => {
          failed.emit(error instanceof Error ? error : new Error(String(error)))
        })
    },
    onCheckingForUpdate: (listener) => listen(checking)(() => listener()),
    onUpdateAvailable: listen(available),
    onUpdateNotAvailable: (listener) => listen(notAvailable)(() => listener()),
    onDownloadProgress: listen(progress),
    onUpdateDownloaded: listen(downloaded),
    onError: listen(failed),
  }
}

export const electrobunUpdateEngine: UpdateEngineShape = createElectrobunUpdateEngine()
