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
   * Installs the window policy before the app is ready: under automation every OS-visible
   * surface (windows, dialogs, external apps, menus, notifications) fails closed and macOS keeps
   * the app out of the Dock.
   */
  readonly installWindowPolicy: () => void
  /**
   * Opens the app's window on the renderer page, with the app's web security policy
   * (`WebSecurityShape`) applied, and shows it once it is ready (hidden under automation).
   */
  readonly openMainWindow: (request: MainWindowRequest) => DesktopWindow
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
