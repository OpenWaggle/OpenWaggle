import { isRecord } from '@shared/utils/validation'

const MARKDOWN_LINK_PATTERN = /!?\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/giu

export interface CapturedImage {
  readonly data: string
  readonly mimeType: string
  readonly title: string
}

export interface CapturedLink {
  readonly url: string
  readonly title: string
  readonly image: boolean
}

function collectMarkdownLinks(text: string, links: CapturedLink[]) {
  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    const url = match[1]
    if (url) links.push({ url, title: url, image: match[0].startsWith('!') })
  }
}

function collectRecord(
  candidate: Readonly<Record<string, unknown>>,
  images: CapturedImage[],
  links: CapturedLink[],
) {
  if (
    candidate.type === 'image' &&
    typeof candidate.data === 'string' &&
    typeof candidate.mimeType === 'string'
  ) {
    images.push({
      data: candidate.data,
      mimeType: candidate.mimeType,
      title: typeof candidate.name === 'string' ? candidate.name : 'Generated image',
    })
    return true
  }
  if (candidate.type !== 'resource_link' || typeof candidate.uri !== 'string') return false
  links.push({
    url: candidate.uri,
    title: typeof candidate.title === 'string' ? candidate.title : candidate.uri,
    image: typeof candidate.mimeType === 'string' && candidate.mimeType.startsWith('image/'),
  })
  return true
}

export function collectExplicitResources(value: unknown) {
  const images: CapturedImage[] = []
  const links: CapturedLink[] = []
  const seen = new WeakSet<object>()
  const pending: unknown[] = [value]

  while (pending.length > 0) {
    const candidate = pending.pop()
    if (typeof candidate === 'string') {
      collectMarkdownLinks(candidate, links)
      continue
    }
    if (Array.isArray(candidate) && !seen.has(candidate)) {
      seen.add(candidate)
      for (const item of candidate) {
        const unknownItem: unknown = item
        pending.push(unknownItem)
      }
      continue
    }
    if (!isRecord(candidate) || seen.has(candidate)) continue
    seen.add(candidate)
    if (!collectRecord(candidate, images, links)) pending.push(...Object.values(candidate))
  }
  return { images, links }
}
