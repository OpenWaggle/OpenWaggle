import { Context } from 'effect'
import type { Unsubscribe } from './shell-events'

/** One release's download directory: the engine reads that release's update metadata there. */
export interface UpdateFeed {
  /** `https://github.com/<owner>/<repo>/releases/download/<tag>/`. */
  readonly releaseUrl: string
}

/** The OpenWaggle feed channel and the platform a release's update metadata must serve. */
export interface UpdateMetadataTarget {
  /** `latest`, `beta` or `alpha` (`updaterFeedChannel`). */
  readonly feedChannel: string
  readonly platform: NodeJS.Platform
  readonly arch: string
}

/** One check that found an update. */
export interface UpdateCheck {
  readonly version: string
  /** Settles when an automatic download ends; `null` when nothing is downloading. */
  readonly download: Promise<unknown> | null
  /** Stops the automatic download this check started. */
  readonly cancelDownload: () => void
}

/**
 * Downloads and installs app updates (ADR 0047, ADR 0064). OpenWaggle's update policy (channels,
 * eligibility, Restart to update, stopping the Session Host) lives in `updater.ts` and
 * `update-cli.ts`; the engine only fetches, verifies and installs. Electron's is
 * electron-updater on the GitHub release feed. Electrobun's updater takes over after the
 * transition release, which existing installs still read from the electron-updater feed; it reads
 * the same release that OpenWaggle's policy selected (`setFeed`), from that release's assets.
 * The policy selects only a release that already carries the file the engine reads
 * (`metadataAssetName`), so a release whose assets are still uploading is never read.
 *
 * The engine never installs on its own: OpenWaggle installs only through `quitAndInstall`.
 */
export interface UpdateEngineShape {
  /**
   * Chooses the channel's metadata file; prereleases only off `stable`, never a downgrade. The
   * engine writes no log of its own after this; OpenWaggle logs what it reports.
   */
  readonly configure: (input: {
    readonly feedChannel: string
    readonly allowPrerelease: boolean
  }) => void
  /** Whether a check that finds an update starts downloading it. */
  readonly setAutoDownload: (autoDownload: boolean) => void
  /**
   * The release asset this engine reads its update metadata from: a release without it is not one
   * the engine can update from on this platform (yet).
   */
  readonly metadataAssetName: (target: UpdateMetadataTarget) => string
  /** Reads the next checks from one release's assets. */
  readonly setFeed: (feed: UpdateFeed) => void
  /** Clears any install the engine had scheduled for the next quit (Electrobun schedules none). */
  readonly cancelInstallOnQuit: () => void
  /** `null` when the feed has nothing newer. */
  readonly checkForUpdates: () => Promise<UpdateCheck | null>
  /**
   * Quits the app and installs the downloaded update. OpenWaggle always installs silently and
   * relaunches; Electrobun's updater can do nothing else.
   */
  readonly quitAndInstall: (input: { readonly silent: boolean; readonly relaunch: boolean }) => void
  readonly onCheckingForUpdate: (listener: () => void) => Unsubscribe
  readonly onUpdateAvailable: (listener: (version: string) => void) => Unsubscribe
  readonly onUpdateNotAvailable: (listener: () => void) => Unsubscribe
  /** Percent of the download received, 0 to 100. */
  readonly onDownloadProgress: (listener: (percent: number) => void) => Unsubscribe
  readonly onUpdateDownloaded: (listener: (version: string) => void) => Unsubscribe
  /** A check, download or install failed; on macOS an install fails only after the quit began. */
  readonly onError: (listener: (error: Error) => void) => Unsubscribe
}

export class UpdateEngine extends Context.Tag('@openwaggle/UpdateEngine')<
  UpdateEngine,
  UpdateEngineShape
>() {}
