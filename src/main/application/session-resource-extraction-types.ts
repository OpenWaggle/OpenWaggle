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
