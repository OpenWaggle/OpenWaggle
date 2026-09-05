import { isRecord } from '@shared/utils/validation'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const HTTP_URL_PATTERN = /^https?:\/\//iu
const markdownParser = unified().use(remarkParse)

export const SESSION_RESOURCE_EXTRACTION_LIMITS = {
  maxImages: 128,
  maxLinks: 128,
  maxTitleCharacters: 512,
  maxUrlCharacters: 4096,
  maxTextCharacters: 256 * 1024,
  maxVisitedNodes: 256,
} as const

export interface CapturedImage {
  readonly data: string
  readonly mimeType: string
  readonly title: string
}

function supportedHttpUrl(value: string) {
  if (value.length > SESSION_RESOURCE_EXTRACTION_LIMITS.maxUrlCharacters) return null
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

export interface CapturedLink {
  readonly url: string
  readonly title: string
  readonly image: boolean
}

function enqueueMarkdownChildren(candidate: Readonly<Record<string, unknown>>, pending: unknown[]) {
  const children = candidate.children
  if (!Array.isArray(children)) return
  for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
}

function markdownDefinitions(root: unknown) {
  const definitions = new Map<string, string>()
  const pending = [root]
  while (pending.length > 0) {
    const candidate = pending.pop()
    if (!isRecord(candidate)) continue
    const normalizedUrl =
      typeof candidate.url === 'string' && HTTP_URL_PATTERN.test(candidate.url)
        ? supportedHttpUrl(candidate.url)
        : null
    if (
      candidate.type === 'definition' &&
      typeof candidate.identifier === 'string' &&
      normalizedUrl
    ) {
      definitions.set(candidate.identifier, normalizedUrl)
    }
    enqueueMarkdownChildren(candidate, pending)
  }
  return definitions
}

function capturedMarkdownLink(
  candidate: Readonly<Record<string, unknown>>,
  definitions: ReadonlyMap<string, string>,
): CapturedLink | null {
  const direct = candidate.type === 'link' || candidate.type === 'image'
  const reference = candidate.type === 'linkReference' || candidate.type === 'imageReference'
  const url = direct
    ? candidate.url
    : reference && typeof candidate.identifier === 'string'
      ? definitions.get(candidate.identifier)
      : null
  if (typeof url !== 'string' || !HTTP_URL_PATTERN.test(url)) return null
  const normalizedUrl = supportedHttpUrl(url)
  if (!normalizedUrl) return null
  return {
    url: normalizedUrl,
    title: normalizedUrl,
    image: candidate.type === 'image' || candidate.type === 'imageReference',
  }
}

function collectMarkdownLinks(text: string, links: CapturedLink[]) {
  if (links.length >= SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks) return
  const root = markdownParser.parse(text)
  const definitions = markdownDefinitions(root)
  const pending: unknown[] = [root]
  while (pending.length > 0 && links.length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks) {
    const candidate = pending.pop()
    if (!isRecord(candidate)) continue
    const link = capturedMarkdownLink(candidate, definitions)
    if (link) links.push(link)
    enqueueMarkdownChildren(candidate, pending)
  }
}

function collectGeneratedImageRecord(
  candidate: Readonly<Record<string, unknown>>,
  images: CapturedImage[],
  remainingTextCharacters: number,
) {
  if (
    candidate.type !== 'image' ||
    typeof candidate.data !== 'string' ||
    typeof candidate.mimeType !== 'string'
  )
    return null
  const title = typeof candidate.name === 'string' ? candidate.name.trim() : 'Generated image'
  const boundedTitle = title.slice(0, SESSION_RESOURCE_EXTRACTION_LIMITS.maxTitleCharacters)
  const consumed = Math.min(title.length, remainingTextCharacters)
  if (
    consumed === title.length &&
    boundedTitle.length > 0 &&
    images.length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxImages
  ) {
    images.push({ data: candidate.data, mimeType: candidate.mimeType, title: boundedTitle })
  }
  return { consumed, handled: true }
}

function collectResourceLinkRecord(
  candidate: Readonly<Record<string, unknown>>,
  links: CapturedLink[],
  remainingTextCharacters: number,
) {
  if (candidate.type !== 'resource_link' || typeof candidate.uri !== 'string') return null
  const url = supportedHttpUrl(candidate.uri)
  const rawTitle = typeof candidate.title === 'string' ? candidate.title.trim() : candidate.uri
  const title = rawTitle.slice(0, SESSION_RESOURCE_EXTRACTION_LIMITS.maxTitleCharacters)
  const consumed = Math.min(candidate.uri.length + rawTitle.length, remainingTextCharacters)
  if (
    url &&
    title.length > 0 &&
    consumed === candidate.uri.length + rawTitle.length &&
    links.length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks
  ) {
    links.push({
      url,
      title,
      image: typeof candidate.mimeType === 'string' && candidate.mimeType.startsWith('image/'),
    })
  }
  return { consumed, handled: true }
}

function collectRecord(
  candidate: Readonly<Record<string, unknown>>,
  images: CapturedImage[],
  links: CapturedLink[],
  remainingTextCharacters: number,
) {
  return (
    collectGeneratedImageRecord(candidate, images, remainingTextCharacters) ??
    collectResourceLinkRecord(candidate, links, remainingTextCharacters) ?? {
      consumed: 0,
      handled: false,
    }
  )
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
  let remainingTextCharacters = SESSION_RESOURCE_EXTRACTION_LIMITS.maxTextCharacters

  while (pending.length > 0) {
    const candidate = pending.pop()
    if (typeof candidate === 'string') {
      const consumed = Math.min(candidate.length, remainingTextCharacters)
      if (consumed > 0) collectMarkdownLinks(candidate.slice(0, consumed), links)
      remainingTextCharacters -= consumed
      continue
    }
    if (Array.isArray(candidate) && !seen.has(candidate)) {
      seen.add(candidate)
      scheduled = enqueueArray(candidate, pending, scheduled)
      continue
    }
    if (!isRecord(candidate) || seen.has(candidate)) continue
    seen.add(candidate)
    const collected = collectRecord(candidate, images, links, remainingTextCharacters)
    remainingTextCharacters -= collected.consumed
    if (!collected.handled) {
      scheduled = enqueueRecord(candidate, pending, scheduled)
    }
  }
  return { images, links }
}
