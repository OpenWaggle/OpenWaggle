import type {
  DesktopDialogsShape,
  FileFilter,
  MessageBoxRequest,
  OpenDialogRequest,
} from '../../ports/desktop-shell/dialogs'
import type { DesktopWindow } from '../../ports/desktop-shell/desktop-windows'
import { assertDesktopUiAllowed, desktopUiAllowed } from './electrobun-automation'
import { showNativeSaveDialog } from './electrobun-save-dialog'
import { electrobun } from './electrobun-sdk'

/** Electrobun's `allowedFileTypes`: comma-separated extensions, `*` for any file. */
function allowedFileTypes(filters: readonly FileFilter[] | undefined) {
  const extensions = (filters ?? []).flatMap((filter) => filter.extensions)
  return extensions.length === 0 || extensions.includes('*') ? '*' : extensions.join(',')
}

function messageBoxType(type: MessageBoxRequest['type']) {
  return type === undefined || type === 'none' ? 'info' : type
}

/**
 * Electrobun's dialogs take no parent window, so a dialog with an owner brings that window to
 * the front first and appears over it; it is app-modal rather than sheet-modal on macOS.
 */
function raise(owner: DesktopWindow | null) {
  if (owner && !owner.isDestroyed()) electrobun().BrowserWindow.getById(owner.id).focus()
}

function openDialogOptions(request: OpenDialogRequest) {
  const properties = request.properties ?? ['openFile']
  return {
    ...(request.defaultPath === undefined ? {} : { startingFolder: request.defaultPath }),
    allowedFileTypes: allowedFileTypes(request.filters),
    canChooseFiles: properties.includes('openFile'),
    canChooseDirectory: properties.includes('openDirectory'),
    allowsMultipleSelection: properties.includes('multiSelections'),
  }
}

/**
 * Native dialogs on Electrobun (ADR 0064): `Utils.showMessageBox` and `Utils.openFileDialog`, and
 * a native save panel (`electrobun-save-dialog.ts`) where Electrobun has none. Every dialog fails
 * closed under non-disruptive automation.
 */
export const electrobunDialogs: DesktopDialogsShape = {
  showMessageBox: async (owner, request) => {
    await desktopUiAllowed('dialog.showMessageBox')
    raise(owner)
    const { response } = await electrobun().Utils.showMessageBox({
      type: messageBoxType(request.type),
      message: request.message,
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.detail === undefined ? {} : { detail: request.detail }),
      ...(request.buttons === undefined ? {} : { buttons: [...request.buttons] }),
      ...(request.defaultId === undefined ? {} : { defaultId: request.defaultId }),
      ...(request.cancelId === undefined ? {} : { cancelId: request.cancelId }),
    })
    return { response }
  },
  showOpenDialog: async (owner, request) => {
    await desktopUiAllowed('dialog.showOpenDialog')
    raise(owner)
    const chosen = await electrobun().Utils.openFileDialog(openDialogOptions(request))
    const filePaths = chosen.filter((filePath) => filePath.length > 0)
    return { canceled: filePaths.length === 0, filePaths }
  },
  showSaveDialog: async (owner, request) => {
    await desktopUiAllowed('dialog.showSaveDialog')
    raise(owner)
    const filePath = await showNativeSaveDialog(request)
    return filePath === null ? { canceled: true } : { canceled: false, filePath }
  },
  showErrorBox: (title, content) => {
    assertDesktopUiAllowed('dialog.showErrorBox')
    void electrobun().Utils.showMessageBox({
      type: 'error',
      title,
      message: title,
      detail: content,
      buttons: ['OK'],
    })
  },
}
