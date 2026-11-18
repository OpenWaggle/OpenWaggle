import { Context } from 'effect'
import type { Unsubscribe } from './shell-events'

/** Where the engine reads update metadata: GitHub releases, or one release's assets. */
export type UpdateFeed =
  | {
      readonly provider: 'github'
      readonly owner: string
      readonly repo: string
      readonly channel: string
    }
  | {
      readonly provider: 'generic'
      readonly url: string
      readonly channel: string
      /** GitHub answers multi-range requests with HTTP 501; differential downloads use one. */
      readonly useMultipleRangeRequest: boolean
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
 * electron-updater on the GitHub release feed.
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
  readonly setFeed: (feed: UpdateFeed) => void
  /** Clears any install the engine had scheduled for the next quit. */
  readonly cancelInstallOnQuit: () => void
  /** `null` when the feed has nothing newer. */
  readonly checkForUpdates: () => Promise<UpdateCheck | null>
  /** Quits the app and installs the downloaded update. */
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
