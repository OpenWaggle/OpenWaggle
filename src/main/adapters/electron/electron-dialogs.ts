import type { MessageBoxOptions, OpenDialogOptions } from 'electron'
import { dialog } from 'electron'
import type {
  DesktopDialogsShape,
  FileFilter,
  MessageBoxRequest,
  OpenDialogRequest,
  SaveDialogRequest,
} from '../../ports/desktop-shell/dialogs'
import type { DesktopWindow } from '../../ports/desktop-shell/desktop-windows'
import { electronWindowOf } from './electron-window-policy'

function filters(list: readonly FileFilter[] | undefined) {
  return list
    ? { filters: list.map((filter) => ({ name: filter.name, extensions: [...filter.extensions] })) }
    : {}
}

function messageBoxOptions(request: MessageBoxRequest) {
  return {
    message: request.message,
    ...(request.type === undefined ? {} : { type: request.type }),
    ...(request.title === undefined ? {} : { title: request.title }),
    ...(request.detail === undefined ? {} : { detail: request.detail }),
    ...(request.buttons === undefined ? {} : { buttons: [...request.buttons] }),
    ...(request.defaultId === undefined ? {} : { defaultId: request.defaultId }),
    ...(request.cancelId === undefined ? {} : { cancelId: request.cancelId }),
    ...(request.noLink === undefined ? {} : { noLink: request.noLink }),
  } satisfies MessageBoxOptions
}

function openDialogOptions(request: OpenDialogRequest) {
  return {
    ...(request.title === undefined ? {} : { title: request.title }),
    ...(request.defaultPath === undefined ? {} : { defaultPath: request.defaultPath }),
    ...(request.buttonLabel === undefined ? {} : { buttonLabel: request.buttonLabel }),
    ...filters(request.filters),
    ...(request.properties === undefined ? {} : { properties: [...request.properties] }),
  } satisfies OpenDialogOptions
}

function saveDialogOptions(request: SaveDialogRequest) {
  return {
    ...(request.title === undefined ? {} : { title: request.title }),
    ...(request.defaultPath === undefined ? {} : { defaultPath: request.defaultPath }),
    ...(request.buttonLabel === undefined ? {} : { buttonLabel: request.buttonLabel }),
    ...filters(request.filters),
  }
}

function ownerOf(owner: DesktopWindow | null) {
  return owner ? electronWindowOf(owner) : null
}

/**
 * Electron's dialogs. Each call looks `dialog` up when it runs, so the automation blockers (and a
 * test's deterministic stand-in installed after them) decide what happens.
 */
export const electronDialogs: DesktopDialogsShape = {
  showMessageBox: (owner, request) => {
    const window = ownerOf(owner)
    const options = messageBoxOptions(request)
    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
  },
  showOpenDialog: (owner, request) => {
    const window = ownerOf(owner)
    const options = openDialogOptions(request)
    return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
  },
  showSaveDialog: (owner, request) => {
    const window = ownerOf(owner)
    const options = saveDialogOptions(request)
    return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
  },
  showErrorBox: (title, content) => dialog.showErrorBox(title, content),
}
