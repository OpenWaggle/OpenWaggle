import { Context } from 'effect'
import type { RendererSurface } from './renderer-surfaces'

/** One top-level app window and the page it shows. */
export interface DesktopWindow {
  readonly id: number
  readonly webContents: RendererSurface
  isDestroyed(): boolean
}

/** An uncompressed BGRA bitmap, as the Windows taskbar overlay takes it. */
export interface DesktopBitmap {
  readonly pixels: Buffer
  readonly width: number
  readonly height: number
}

export interface MainWindowRequest {
  /** The window icon on Windows and Linux. */
  readonly appIconPath: string
  /** Records startup milestones (`window-ready-to-show`, `renderer-dom-ready`, ...). */
  readonly startupMark: (label: string) => void
  /**
   * Opens a link the page navigated to, or opened in a new window, outside the app's own
   * documents. The window never follows it; the app decides where it goes.
   */
  readonly openLink: (url: string) => void
}

/**
 * The app's top-level windows and the window policy (ADR 0064).
 *
 * Non-disruptive automation (`OPENWAGGLE_AUTOMATION=1`) never reveals or focuses a window: every
 * window is created hidden, and `reveal`, `revealInactive` and `focus` throw
 * `AutomationDesktopUiError` there instead of touching the screen.
 */
export interface DesktopWindowsShape {
  /**
   * Installs the window policy before anything else runs, in the app and in the Session Host:
   * under automation every OS-visible surface (windows, dialogs, external apps, menus,
   * notifications) fails closed. Keeping the app out of the Dock is
   * `SystemIntegrationShape.setActivationPolicy`.
   */
  readonly installWindowPolicy: () => void
  /**
   * After ready: the keyboard shortcuts of every window opened from now on. Unpackaged builds
   * toggle DevTools with F12; packaged builds swallow reload (Cmd/Ctrl+R) and the DevTools
   * chords; no build zooms with Cmd/Ctrl+Minus or Cmd/Ctrl+Shift+Equal.
   */
  readonly installWindowShortcuts: () => void
  /**
   * Opens the app's window on the renderer page, with the app's web security policy
   * (`WebSecurityShape`) applied, and shows it once it is ready (hidden under automation).
   */
  readonly openMainWindow: (request: MainWindowRequest) => DesktopWindow
  /**
   * Before the first main window: whatever its renderer needs installed. A hidden QA window that
   * renders with CEF on macOS waits for the CEF component (`BrowserEngineShape`), which a release
   * build installs instead of bundling; it never fails, and the window falls back to the system
   * webview when the engine cannot be installed.
   */
  readonly prepareMainWindow: () => Promise<void>
  /** Every open window, the main window first. */
  readonly all: () => readonly DesktopWindow[]
  /** The window that has keyboard focus, or `null` when the app is in the background. */
  readonly focused: () => DesktopWindow | null
  /** The window that shows `surface`, or `null` for a page in no window. */
  readonly fromSurface: (surface: RendererSurface) => DesktopWindow | null
  readonly reveal: (window: DesktopWindow) => void
  /** Shows a window without taking focus from the app in front. */
  readonly revealInactive: (window: DesktopWindow) => void
  /** Restores a minimized window, shows it and gives it focus. */
  readonly focus: (window: DesktopWindow) => void
  /**
   * The Windows taskbar overlay icon of `window`; `null` removes it. Other platforms and
   * automation ignore it.
   */
  readonly setOverlayIcon: (
    window: DesktopWindow,
    bitmap: DesktopBitmap | null,
    description: string,
  ) => void
}

export class DesktopWindows extends Context.Tag('@openwaggle/DesktopWindows')<
  DesktopWindows,
  DesktopWindowsShape
>() {}
