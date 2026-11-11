import { randomBytes } from 'node:crypto'
import { parseJsonUnknown, safeDecodeUnknown, Schema } from '@shared/schema'
import type { BrowserPreviewKeyInput } from '../../browser-preview/browser-preview-key-input'

const MARKER_BYTES = 16

/** A random URL marker that names one preview's page in the DevTools target list. */
export function newBrowserPreviewMarker() {
  return `openwaggle-preview-${randomBytes(MARKER_BYTES).toString('hex')}`
}

/** The first URL of a preview: blank, carrying its marker. */
export function browserPreviewMarkerUrl(marker: string) {
  return `about:blank#${marker}`
}

/** What a preview's page reports. */
export type ElectrobunPreviewGuestEvent =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded' }
  | { readonly kind: 'navigated'; readonly url: string }
  | { readonly kind: 'title'; readonly title: string }
  | { readonly kind: 'history'; readonly canGoBack: boolean; readonly canGoForward: boolean }
  | {
      readonly kind: 'failed'
      readonly code: string
      readonly description: string
      readonly url: string
    }
  | { readonly kind: 'crashed' }
  | { readonly kind: 'key'; readonly input: BrowserPreviewKeyInput }
  /** CDP is unavailable or was lost; the page still browses, CDP features fail. */
  | { readonly kind: 'detached'; readonly reason: string }

const FrameSchema = Schema.Struct({
  id: Schema.String,
  parentId: Schema.optional(Schema.String),
  url: Schema.String,
  urlFragment: Schema.optional(Schema.String),
})
export const FrameNavigatedSchema = Schema.Struct({ frame: FrameSchema })
export const FrameIdSchema = Schema.Struct({ frameId: Schema.String })
export const SameDocumentSchema = Schema.Struct({ frameId: Schema.String, url: Schema.String })
export const FrameTreeSchema = Schema.Struct({ frameTree: Schema.Struct({ frame: FrameSchema }) })
export const NavigateResultSchema = Schema.Struct({ errorText: Schema.optional(Schema.String) })
export const HistorySchema = Schema.Struct({
  currentIndex: Schema.Number,
  entries: Schema.Array(Schema.Struct({ id: Schema.Number, url: Schema.String })),
})
export const ScreenshotSchema = Schema.Struct({ data: Schema.String })
export const BindingCalledSchema = Schema.Struct({ name: Schema.String, payload: Schema.String })
export const ScriptIdentifierSchema = Schema.Struct({ identifier: Schema.String })
export const ContextCreatedSchema = Schema.Struct({
  context: Schema.Struct({ id: Schema.Number, name: Schema.String }),
})
export const ContextDestroyedSchema = Schema.Struct({ executionContextId: Schema.Number })
export const PageMessageSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('title'), title: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('key'),
    type: Schema.String,
    key: Schema.String,
    code: Schema.String,
    location: Schema.Number,
    alt: Schema.Boolean,
    control: Schema.Boolean,
    meta: Schema.Boolean,
    shift: Schema.Boolean,
    isComposing: Schema.Boolean,
    isAutoRepeat: Schema.Boolean,
  }),
)

export function decode<A, I>(schema: Schema.Schema<A, I>, value: unknown): A | null {
  const decoded = safeDecodeUnknown(schema, value)
  return decoded.success ? decoded.data : null
}

export function decodeJson<A, I>(schema: Schema.Schema<A, I>, raw: string): A | null {
  try {
    return decode(schema, parseJsonUnknown(raw))
  } catch {
    return null
  }
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
