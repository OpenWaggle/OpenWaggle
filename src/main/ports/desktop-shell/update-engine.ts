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

export interface UpdateEngineEvents {
  readonly 'checking-for-update': () => void
  readonly 'update-available': (version: string) => void
  readonly 'update-not-available': () => void
  readonly 'download-progress': (percent: number) => void
  readonly 'update-downloaded': (version: string) => void
  readonly error: (error: Error) => void
}

/**
 * Downloads and installs app updates (ADR 0047, ADR 0064). OpenWaggle's update policy (channels,
 * eligibility, Restart to update, stopping the Session Host) lives in `updater.ts` and
 * `update-cli.ts`; the engine only fetches, verifies and installs. Electron's is
 * electron-updater on the GitHub release feed. Electrobun's updater takes over after the
 * transition release, which existing installs still read from the electron-updater feed.
 *
 * The engine never installs on its own: OpenWaggle installs only through `quitAndInstall`.
 */
export interface UpdateEngineShape {
  /** Chooses the channel's metadata file; prereleases only off `stable`, never a downgrade. */
  readonly configure: (input: {
    readonly feedChannel: string
    readonly allowPrerelease: boolean
    readonly autoDownload: boolean
  }) => void
  readonly setFeed: (feed: UpdateFeed) => void
  /** Clears any install the engine had scheduled for the next quit. */
  readonly cancelInstallOnQuit: () => void
  /** `null` when the feed has nothing newer. */
  readonly checkForUpdates: () => Promise<UpdateCheck | null>
  /** Quits the app and installs the downloaded update. */
  readonly quitAndInstall: (input: { readonly silent: boolean; readonly relaunch: boolean }) => void
  readonly on: <E extends keyof UpdateEngineEvents>(
    event: E,
    listener: UpdateEngineEvents[E],
  ) => Unsubscribe
}

export class UpdateEngine extends Context.Tag('@openwaggle/UpdateEngine')<
  UpdateEngine,
  UpdateEngineShape
>() {}
