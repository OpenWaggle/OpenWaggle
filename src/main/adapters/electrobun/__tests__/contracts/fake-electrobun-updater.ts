/**
 * A faithful stand-in for Electrobun's `Updater` (`electrobun/main`) for the UpdateEngine contract:
 * the installed `version.json`, what the release host offers, the single status callback, and the
 * native preparation and install the adapter starts. It reports in Electrobun's own terms (status
 * entries, `updateInfo()`), never in OpenWaggle's.
 */
import type { Updater as ElectrobunUpdater, UpdateStatusEntry } from 'electrobun/main'

type LocalUpdateInfo = Awaited<ReturnType<typeof ElectrobunUpdater.getLocalInfo>>
type UpdateInfo = ReturnType<typeof ElectrobunUpdater.updateInfo>
type StatusEntryInput = Omit<UpdateStatusEntry, 'timestamp'>

const INSTALLED_HASH = 'installed-hash'

export function fakeElectrobunUpdater(installedVersion = '1.0.0') {
  const localInfo: LocalUpdateInfo = {
    version: installedVersion,
    hash: INSTALLED_HASH,
    baseUrl: 'https://github.com/OpenWaggle/OpenWaggle/releases/latest/download',
    channel: 'stable',
    name: 'OpenWaggle',
    identifier: 'com.openwaggle.app',
  }
  const state: {
    offered: string | null
    info: UpdateInfo
    callback: ((entry: UpdateStatusEntry) => void) | null
    checkedUrls: string[]
    downloadsStarted: number
    /** Native preparations wait for `finishDownloads()` instead of finishing at once. */
    holdDownloads: boolean
    pending: (() => void)[]
    applies: number
  } = {
    offered: null,
    info: { version: '', hash: '', updateAvailable: false, updateReady: false, error: '' },
    callback: null,
    checkedUrls: [],
    downloadsStarted: 0,
    holdDownloads: false,
    pending: [],
    applies: 0,
  }

  function emit(entry: StatusEntryInput) {
    state.callback?.({ ...entry, timestamp: Date.now() })
  }

  const Updater = {
    updateInfo: () => state.info,
    onStatusChange: (callback: ((entry: UpdateStatusEntry) => void) | null) => {
      state.callback = callback
    },
    // Electrobun returns its one cached object, which later checks and installs read.
    getLocalInfo: async () => localInfo,
    localInfo: { baseUrl: async () => localInfo.baseUrl },
    checkForUpdate: async () => {
      emit({ status: 'checking', message: 'Checking for updates...' })
      state.checkedUrls.push(localInfo.baseUrl)
      const offered = state.offered
      state.info = {
        version: offered ?? localInfo.version,
        hash: offered === null ? localInfo.hash : `hash-${offered}`,
        updateAvailable: offered !== null,
        updateReady: false,
        error: '',
      }
      if (offered === null) emit({ status: 'no-update', message: 'Already on latest version' })
      else emit({ status: 'update-available', message: 'Update available' })
      return state.info
    },
    downloadUpdate: async () => {
      state.downloadsStarted += 1
      if (state.holdDownloads) await new Promise<void>((resolve) => state.pending.push(resolve))
      state.info = { ...state.info, updateReady: true }
      emit({ status: 'download-complete', message: 'Update downloaded, verified, and staged' })
    },
    applyUpdate: async () => {
      state.applies += 1
    },
  }

  return {
    Updater,
    localInfo,
    state,
    /** The release host offers `version` on the next check (`null`: nothing newer). */
    offer: (version: string | null) => {
      state.offered = version
    },
    finishDownloads: () => {
      for (const resolve of state.pending.splice(0)) resolve()
    },
    /** Electrobun reports an update, as a check that found one does. */
    reportAvailable: (version: string) => {
      state.info = { ...state.info, version, updateAvailable: true }
      emit({ status: 'update-available', message: 'Update available' })
    },
    reportProgress: (progress: number) =>
      emit({ status: 'download-progress', message: 'Downloading', details: { progress } }),
    reportDownloaded: (version: string) => {
      state.info = { ...state.info, version, updateAvailable: true, updateReady: true }
      emit({ status: 'download-complete', message: 'Update downloaded, verified, and staged' })
    },
    reportError: (message: string) =>
      emit({ status: 'error', message, details: { errorMessage: message } }),
  }
}
