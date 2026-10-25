export const SESSION_RESOURCE_EXTRACTION_LIMITS = {
  maxImages: 128,
  maxLinks: 128,
  maxSites: 32,
  maxTitleCharacters: 512,
  maxUrlCharacters: 4096,
  maxTextCharacters: 256 * 1024,
  maxVisitedNodes: 256,
} as const

export interface CapturedGeneratedImage {
  readonly data: string
  readonly mimeType: string
  readonly title: string
}

export interface CapturedLocalImage {
  readonly filePath: string
  readonly mimeType: string
  readonly title: string
}

export type CapturedImage = CapturedGeneratedImage | CapturedLocalImage

export interface CapturedLink {
  readonly url: string
  readonly title: string
  readonly image: boolean
}

export interface CapturedSite {
  readonly url: string
  readonly title: string
  readonly activity: 'created' | 'updated'
}

export type CapturedResourceOrder =
  | { readonly kind: 'image'; readonly index: number }
  | { readonly kind: 'link'; readonly index: number }

/**
 * What a Markdown image destination that is not a web URL names, decided by who wrote the text.
 *
 * - `local-file`: a file on this machine (`/tmp/shot.png`, `file:` URLs, drive letters). Agents
 *   reference their screenshots this way, so it is the default.
 * - `website`: a page of `origin`. Docs topics write their screenshots root-relative
 *   (`/screenshots/x.png`); those are images of the website, not files, and the installed docs
 *   bundle does not ship them.
 * - `none`: nothing; such references are not captured.
 */
export type MarkdownImageOrigin =
  | { readonly kind: 'local-file' }
  | { readonly kind: 'website'; readonly origin: string }
  | { readonly kind: 'none' }

export const LOCAL_FILE_MARKDOWN_IMAGES: MarkdownImageOrigin = { kind: 'local-file' }
