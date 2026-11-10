import { Context } from 'effect'
import type { DesktopWindow } from './desktop-windows'

/**
 * Menu actions the shell performs itself. Both Electron and Electrobun implement these roles
 * natively, with the platform's own label and accelerator unless the item sets one.
 */
export type ShellMenuRole =
  | 'about'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'reload'
  | 'forceReload'
  | 'toggleDevTools'
  | 'togglefullscreen'

/** One menu entry: a role, a submenu, an action with a label, or a separator. */
export interface ShellMenuItem {
  readonly type?: 'normal' | 'separator'
  readonly label?: string
  readonly role?: ShellMenuRole
  readonly accelerator?: string
  readonly enabled?: boolean
  readonly submenu?: readonly ShellMenuItem[]
  readonly click?: () => void
}

/**
 * The application menu and context menus (ADR 0064). Context menus never open during
 * non-disruptive automation: `popupContextMenu` throws `AutomationDesktopUiError` there.
 */
export interface DesktopMenusShape {
  /** Replaces the application menu; `null` removes it (and its shortcuts). */
  readonly setApplicationMenu: (items: readonly ShellMenuItem[] | null) => void
  /** Opens a context menu over `window` at the pointer. */
  readonly popupContextMenu: (window: DesktopWindow, items: readonly ShellMenuItem[]) => void
}

export class DesktopMenus extends Context.Tag('@openwaggle/DesktopMenus')<
  DesktopMenus,
  DesktopMenusShape
>() {}
