import { isRecord } from '@shared/utils/validation'

const MARKDOWN_LINK_OPENER_PATTERN = /!?\[[^\]]*\]\((https?:\/\/)/giu

export const SESSION_RESOURCE_EXTRACTION_LIMITS = {
  maxImages: 128,
  maxLinks: 128,
  maxTextCharacters: 256 * 1024,
  maxVisitedNodes: 256,
} as const

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

function markdownDestination(text: string, start: number) {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === '(') {
      depth += 1
      continue
    }
    if (character !== ')') {
      if (character && /\s/u.test(character)) return null
      continue
    }
    if (depth === 0) return text.slice(start, index)
    depth -= 1
  }
  return null
}

function collectMarkdownLinks(text: string, links: CapturedLink[]) {
  if (links.length >= SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks) return
  const boundedText = text.slice(0, SESSION_RESOURCE_EXTRACTION_LIMITS.maxTextCharacters)
  for (const match of boundedText.matchAll(MARKDOWN_LINK_OPENER_PATTERN)) {
    const prefix = match[1]
    const url = prefix
      ? markdownDestination(boundedText, (match.index ?? 0) + match[0].length - prefix.length)
      : null
    if (url) links.push({ url, title: url, image: match[0].startsWith('!') })
    if (links.length >= SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks) break
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
    if (images.length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxImages) {
      images.push({
        data: candidate.data,
        mimeType: candidate.mimeType,
        title: typeof candidate.name === 'string' ? candidate.name : 'Generated image',
      })
    }
    return true
  }
  if (candidate.type !== 'resource_link' || typeof candidate.uri !== 'string') return false
  if (links.length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks) {
    links.push({
      url: candidate.uri,
      title: typeof candidate.title === 'string' ? candidate.title : candidate.uri,
      image: typeof candidate.mimeType === 'string' && candidate.mimeType.startsWith('image/'),
    })
  }
  return true
}

function enqueueArray(candidate: readonly unknown[], pending: unknown[], scheduled: number) {
  const available = SESSION_RESOURCE_EXTRACTION_LIMITS.maxVisitedNodes - scheduled
  if (available <= 0) return scheduled
  const count = Math.min(candidate.length, available)
  for (let index = count - 1; index >= 0; index -= 1) pending.push(candidate[index])
  return scheduled + count
}

function enqueueRecord(
  candidate: Readonly<Record<string, unknown>>,
  pending: unknown[],
  scheduled: number,
) {
  const children: unknown[] = []
  const available = SESSION_RESOURCE_EXTRACTION_LIMITS.maxVisitedNodes - scheduled
  if (available <= 0) return scheduled
  for (const key in candidate) {
    if (!Object.hasOwn(candidate, key)) continue
    children.push(candidate[key])
    if (children.length >= available) break
  }
  for (let index = children.length - 1; index >= 0; index -= 1) {
    pending.push(children[index])
  }
  return scheduled + children.length
}

export function collectExplicitResources(value: unknown) {
  const images: CapturedImage[] = []
  const links: CapturedLink[] = []
  const seen = new WeakSet<object>()
  const pending: unknown[] = [value]
  let scheduled = 1

  while (pending.length > 0) {
    const candidate = pending.pop()
    if (typeof candidate === 'string') {
      collectMarkdownLinks(candidate, links)
      continue
    }
    if (Array.isArray(candidate) && !seen.has(candidate)) {
      seen.add(candidate)
      scheduled = enqueueArray(candidate, pending, scheduled)
      continue
    }
    if (!isRecord(candidate) || seen.has(candidate)) continue
    seen.add(candidate)
    if (!collectRecord(candidate, images, links)) {
      scheduled = enqueueRecord(candidate, pending, scheduled)
    }
  }
  return { images, links }
}
