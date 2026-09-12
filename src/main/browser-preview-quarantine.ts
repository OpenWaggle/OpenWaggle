import type { Event, WebContents } from 'electron'
import { monitorBrowserPreviewSecurityPrompts } from './browser-preview-security-prompts'

const quarantinedContents = new WeakSet<WebContents>()

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

export function quarantineBrowserPreviewContents(contents: WebContents): void {
  quarantinedContents.add(contents)
}

/** Cached automation pages must not regain access after their renderer owner retires. */
export function assertBrowserPreviewContentsAvailable(contents: WebContents): void {
  if (quarantinedContents.has(contents)) {
    throw new Error('Browser preview owner is retired; only native close cleanup is available.')
  }
}
