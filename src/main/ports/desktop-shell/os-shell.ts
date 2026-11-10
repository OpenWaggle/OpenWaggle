import { Context } from 'effect'

/**
 * Hands a URL or a file to the operating system (ADR 0064): the default browser, the default
 * application, the file manager and the Trash. Under non-disruptive automation each one rejects
 * (or throws) with `AutomationDesktopUiError` and launches nothing.
 */
export interface OsShellShape {
  readonly openExternal: (url: string) => Promise<void>
  /** Opens a file or folder with its default application; resolves to an error text or `''`. */
  readonly openPath: (targetPath: string) => Promise<string>
  /** Shows the item selected in the file manager. */
  readonly showItemInFolder: (targetPath: string) => void
  /** Moves the item to the Trash (Recycle Bin); rejects when the system refuses. */
  readonly trashItem: (targetPath: string) => Promise<void>
  /** The system alert sound. */
  readonly beep: () => void
}

export class OsShell extends Context.Tag('@openwaggle/OsShell')<OsShell, OsShellShape>() {}
