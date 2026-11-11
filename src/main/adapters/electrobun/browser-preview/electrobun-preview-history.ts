import { Schema } from '@shared/schema'
import { decode, type ElectrobunPreviewGuestEvent } from './electrobun-preview-cdp-protocol'
import type { CdpSend } from './electrobun-preview-screenshots'

const HistorySchema = Schema.Struct({
  currentIndex: Schema.Number,
  entries: Schema.Array(
    Schema.Struct({ id: Schema.Number, url: Schema.String, title: Schema.optional(Schema.String) }),
  ),
})

/**
 * The current entry's title, or `null` before the page has one. A page restored from the
 * back-forward cache runs no script, so the history is where its title comes from.
 */
export function browserPreviewHistoryTitle(
  history: Schema.Schema.Type<typeof HistorySchema>,
  marker: string,
) {
  const entry = history.entries[history.currentIndex]
  if (entry?.title === undefined || entry.title === '' || entry.url.includes(marker)) return null
  return entry.title
}

/** Whether the history entries around the current one are pages, not the blank marker page. */
export function browserPreviewHistoryFlags(
  history: Schema.Schema.Type<typeof HistorySchema>,
  marker: string,
) {
  const isPage = (index: number) => {
    const entry = history.entries[index]
    return entry !== undefined && !entry.url.includes(marker)
  }
  return {
    canGoBack: isPage(history.currentIndex - 1),
    canGoForward: isPage(history.currentIndex + 1),
  }
}

async function navigationHistory(send: CdpSend) {
  return decode(HistorySchema, await send('Page.getNavigationHistory'))
}

/** Goes one entry back or forward, never onto the blank page the preview started on. */
export async function stepInHistory(send: CdpSend, marker: string, step: -1 | 1) {
  const history = await navigationHistory(send)
  const entry = history?.entries[history.currentIndex + step]
  if (entry === undefined || entry.url.includes(marker)) return
  await send('Page.navigateToHistoryEntry', { entryId: entry.id })
}

/** What the history says about the page now: its back and forward flags, and its title. */
export async function historyEvents(
  send: CdpSend,
  marker: string,
): Promise<readonly ElectrobunPreviewGuestEvent[]> {
  const history = await navigationHistory(send)
  if (history === null) return []
  const title = browserPreviewHistoryTitle(history, marker)
  return [
    { kind: 'history', ...browserPreviewHistoryFlags(history, marker) },
    ...(title === null ? [] : [{ kind: 'title' as const, title }]),
  ]
}
