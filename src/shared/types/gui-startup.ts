/**
 * Where the desktop window's startup stands (maintainer decision 3, A-F2): the window opens
 * before the Session Host answers and shows a static skeleton; Host-backed requests wait until
 * the Host is ready. A Host that fails, or is not ready within about 10 s, shows a plain error
 * screen with Retry and Open logs instead of the old silent quit. A Host handing over to an
 * update shows "Finishing an update…" with a longer deadline, and the usual one applies again
 * once it has handed over.
 */
export type GuiStartupFailureReason = 'error' | 'timeout'

export type GuiStartupStatus =
  | { readonly state: 'starting' }
  | { readonly state: 'updating' }
  | { readonly state: 'ready' }
  | {
      readonly state: 'failed'
      readonly reason: GuiStartupFailureReason
      /** A short, already redacted explanation for the error screen. */
      readonly message: string
    }

export type GuiStartupState = GuiStartupStatus['state']

/** How long the window waits for the Host before it shows the error screen. */
export const GUI_STARTUP_SLOW_AFTER_MS = 10_000

/** How long the window waits for a Host to hand over to an update before the error screen. */
export const GUI_STARTUP_UPDATE_SLOW_AFTER_MS = 5 * 60_000
