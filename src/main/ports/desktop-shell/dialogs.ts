import { Context } from 'effect'
import type { DesktopWindow } from './desktop-windows'

export interface MessageBoxRequest {
  readonly type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  readonly title?: string
  readonly message: string
  readonly detail?: string
  readonly buttons?: readonly string[]
  readonly defaultId?: number
  readonly cancelId?: number
  /** Show every button as a button, never as a command link (Windows). */
  readonly noLink?: boolean
}

export interface MessageBoxResult {
  /** The index of the button chosen; `cancelId` when the box was dismissed. */
  readonly response: number
}

export interface FileFilter {
  readonly name: string
  readonly extensions: readonly string[]
}

export interface OpenDialogRequest {
  readonly title?: string
  readonly defaultPath?: string
  readonly buttonLabel?: string
  readonly filters?: readonly FileFilter[]
  readonly properties?: readonly ('openFile' | 'openDirectory' | 'multiSelections')[]
}

export interface OpenDialogResult {
  readonly canceled: boolean
  readonly filePaths: readonly string[]
}

export interface SaveDialogRequest {
  readonly title?: string
  readonly defaultPath?: string
  readonly buttonLabel?: string
  readonly filters?: readonly FileFilter[]
}

export interface SaveDialogResult {
  readonly canceled: boolean
  readonly filePath?: string
}

/**
 * Native dialogs (ADR 0064). A dialog with an owner window is modal to it. Under non-disruptive
 * automation every dialog rejects (or throws, for `showErrorBox`) with
 * `AutomationDesktopUiError` instead of appearing, unless a test replaced it.
 */
export interface DesktopDialogsShape {
  readonly showMessageBox: (
    owner: DesktopWindow | null,
    request: MessageBoxRequest,
  ) => Promise<MessageBoxResult>
  readonly showOpenDialog: (
    owner: DesktopWindow | null,
    request: OpenDialogRequest,
  ) => Promise<OpenDialogResult>
  readonly showSaveDialog: (
    owner: DesktopWindow | null,
    request: SaveDialogRequest,
  ) => Promise<SaveDialogResult>
  /** A blocking error message, usable before the app is ready. */
  readonly showErrorBox: (title: string, content: string) => void
}

export class DesktopDialogs extends Context.Tag('@openwaggle/DesktopDialogs')<
  DesktopDialogs,
  DesktopDialogsShape
>() {}
