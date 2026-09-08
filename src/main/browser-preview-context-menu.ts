import { isBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type {
  BrowserWindow,
  ContextMenuParams,
  Event,
  Menu,
  MenuItemConstructorOptions,
  WebContents,
} from 'electron'
import { clipboard } from 'electron'
import { popupWebContentsMenu } from './desktop-ui'
import { describeError } from './error-description'
import { createLogger } from './logger'

const MAX_SPELLING_SUGGESTIONS = 5
const logger = createLogger('browser-preview-context-menu')

/** Native editing stays in the clicked preview frame, never the host composer. */
export function installBrowserPreviewContextMenu(contents: WebContents, window: BrowserWindow) {
  let disposed = false
  let generation = 0
  let menu: Menu | undefined
  const dismiss = () => {
    generation += 1
    menu?.closePopup(window.isDestroyed() ? undefined : window)
    menu = undefined
  }
  const onContextMenu = (event: Event, params: ContextMenuParams) => {
    event.preventDefault()
    dismiss()
    if (disposed || contents.isDestroyed() || window.isDestroyed() || params.frame?.detached) return
    const requestGeneration = generation
    const act = (action: () => void) => () => {
      if (
        disposed ||
        generation !== requestGeneration ||
        contents.isDestroyed() ||
        window.isDestroyed() ||
        params.frame?.detached
      )
        return
      action()
    }
    const template: MenuItemConstructorOptions[] = []
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, MAX_SPELLING_SUGGESTIONS)
      for (const suggestion of suggestions) {
        template.push({
          label: suggestion,
          click: act(() => contents.replaceMisspelling(suggestion)),
        })
      }
      if (suggestions.length === 0) template.push({ label: 'No suggestions', enabled: false })
      template.push({ type: 'separator' })
    }
    if (isBrowserPreviewUrl(params.linkURL)) {
      template.push({ label: 'Copy Link', click: act(() => clipboard.writeText(params.linkURL)) })
      template.push({ type: 'separator' })
    }
    if (params.mediaType === 'image') {
      template.push({
        label: 'Copy Image',
        click: act(() => contents.copyImageAt(params.x, params.y)),
      })
      template.push({ type: 'separator' })
    }
    template.push(
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    )
    try {
      menu = popupWebContentsMenu(window, contents, template, params.frame)
    } catch (error) {
      logger.warn('Could not open preview context menu', describeError(error))
    }
  }
  contents.on('context-menu', onContextMenu)
  contents.on('did-start-navigation', dismiss)
  return () => {
    disposed = true
    dismiss()
    contents.removeListener('context-menu', onContextMenu)
    contents.removeListener('did-start-navigation', dismiss)
  }
}
