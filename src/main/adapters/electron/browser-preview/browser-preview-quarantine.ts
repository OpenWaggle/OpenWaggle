import type { Event, WebContents } from 'electron'
import {
  assertBrowserPreviewContentsAvailable as assertAvailable,
  type BrowserPreviewAutomationContents,
  retireBrowserPreviewContents,
} from '../../browser-preview/automation/browser-preview-automation-contents'
import { monitorBrowserPreviewSecurityPrompts } from './browser-preview-security-prompts'

export function installBrowserPreviewQuarantinePolicy(contents: WebContents): void {
  const removeSecurityPrompts = monitorBrowserPreviewSecurityPrompts(contents)
  const deny = (event: Event) => event.preventDefault()
  contents.on('will-navigate', deny)
  contents.on('will-redirect', deny)
  contents.on('content-bounds-updated', deny)
  contents.on('will-prevent-unload', deny)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.once('destroyed', () => {
    const cleanup = [
      ...removeSecurityPrompts,
      () => contents.removeListener('will-navigate', deny),
      () => contents.removeListener('will-redirect', deny),
      () => contents.removeListener('content-bounds-updated', deny),
      () => contents.removeListener('will-prevent-unload', deny),
    ]
    for (const remove of cleanup) {
      try {
        remove()
      } catch {
        /* Continue revoking listeners after native teardown races. */
      }
    }
  })
}

export function quarantineBrowserPreviewContents(contents: BrowserPreviewAutomationContents): void {
  retireBrowserPreviewContents(contents)
}

/** Cached automation pages must not regain access after their renderer owner retires. */
export function assertBrowserPreviewContentsAvailable(
  contents: BrowserPreviewAutomationContents,
): void {
  assertAvailable(contents)
}
