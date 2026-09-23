import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord } from '@shared/utils/validation'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import {
  type CapturedImage,
  type CapturedLink,
  type CapturedLocalImage,
  type CapturedResourceOrder,
  SESSION_RESOURCE_EXTRACTION_LIMITS,
} from './session-resource-extraction-types'

const HTTP_URL_PATTERN = /^https?:\/\//iu
const markdownParser = unified().use(remarkParse)

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

function enqueueChildren(candidate: Readonly<Record<string, unknown>>, pending: unknown[]) {
  const children = candidate.children
  if (!Array.isArray(children)) return
  for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index])
}

function children(candidate: Readonly<Record<string, unknown>>): readonly unknown[] {
  return Array.isArray(candidate.children) ? candidate.children : []
}

function definitions(root: unknown) {
  const result = new Map<string, string>()
  const pending = [root]
  while (pending.length > 0) {
    const candidate = pending.pop()
    if (!isRecord(candidate)) continue
    if (
      candidate.type === 'definition' &&
      typeof candidate.identifier === 'string' &&
      typeof candidate.url === 'string' &&
      candidate.url.length <= SESSION_RESOURCE_EXTRACTION_LIMITS.maxUrlCharacters
    ) {
      result.set(candidate.identifier, candidate.url)
    }
    enqueueChildren(candidate, pending)
  }
  return result
}

function label(candidate: Readonly<Record<string, unknown>>) {
  const directAlt = typeof candidate.alt === 'string' ? candidate.alt.trim() : ''
  if (directAlt) return directAlt.slice(0, SESSION_RESOURCE_EXTRACTION_LIMITS.maxTitleCharacters)

  const pending = [...children(candidate)].reverse()
  const fragments: string[] = []
  let visited = 0
  let length = 0
  while (
    pending.length > 0 &&
    visited < SESSION_RESOURCE_EXTRACTION_LIMITS.maxVisitedNodes &&
    length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxTitleCharacters
  ) {
    const child = pending.pop()
    visited += 1
    if (!isRecord(child)) continue
    if ((child.type === 'text' || child.type === 'inlineCode') && typeof child.value === 'string') {
      const fragment = child.value.slice(
        0,
        SESSION_RESOURCE_EXTRACTION_LIMITS.maxTitleCharacters - length,
      )
      fragments.push(fragment)
      length += fragment.length
    }
    const nested = children(child)
    for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index])
  }
  return fragments.join('').trim()
}

function markdownUrl(
  candidate: Readonly<Record<string, unknown>>,
  knownDefinitions: ReadonlyMap<string, string>,
) {
  const direct = candidate.type === 'link' || candidate.type === 'image'
  const reference = candidate.type === 'linkReference' || candidate.type === 'imageReference'
  const url = direct
    ? candidate.url
    : reference && typeof candidate.identifier === 'string'
      ? knownDefinitions.get(candidate.identifier)
      : null
  return typeof url === 'string' ? url : null
}

function imageMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  return null
}

function localImage(
  candidate: Readonly<Record<string, unknown>>,
  knownDefinitions: ReadonlyMap<string, string>,
): CapturedLocalImage | null {
  if (candidate.type !== 'image' && candidate.type !== 'imageReference') return null
  const url = markdownUrl(candidate, knownDefinitions)
  if (!url || url.length > SESSION_RESOURCE_EXTRACTION_LIMITS.maxUrlCharacters) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:' || parsed.username || parsed.password) return null
    const filePath = fileURLToPath(parsed)
    if (filePath.includes('\0')) return null
    const mimeType = imageMimeType(filePath)
    if (!mimeType) return null
    return { filePath, mimeType, title: label(candidate) || path.basename(filePath) }
  } catch {
    return null
  }
}

function httpLink(
  candidate: Readonly<Record<string, unknown>>,
  knownDefinitions: ReadonlyMap<string, string>,
): CapturedLink | null {
  const url = markdownUrl(candidate, knownDefinitions)
  if (!url || !HTTP_URL_PATTERN.test(url)) return null
  const normalizedUrl = supportedHttpUrl(url)
  if (!normalizedUrl) return null
  return {
    url: normalizedUrl,
    title: label(candidate) || normalizedUrl,
    image: candidate.type === 'image' || candidate.type === 'imageReference',
  }
}

export function collectMarkdownResources(
  text: string,
  images: CapturedImage[],
  links: CapturedLink[],
  order: CapturedResourceOrder[],
) {
  if (
    images.length >= SESSION_RESOURCE_EXTRACTION_LIMITS.maxImages &&
    links.length >= SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks
  )
    return
  const root = markdownParser.parse(text)
  const knownDefinitions = definitions(root)
  const pending: unknown[] = [root]
  while (pending.length > 0) {
    const candidate = pending.pop()
    if (!isRecord(candidate)) continue
    const image = localImage(candidate, knownDefinitions)
    if (image && images.length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxImages) {
      order.push({ kind: 'image', index: images.length })
      images.push(image)
      enqueueChildren(candidate, pending)
      continue
    }
    if (links.length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxLinks) {
      const link = httpLink(candidate, knownDefinitions)
      if (link) {
        order.push({ kind: 'link', index: links.length })
        links.push(link)
      }
    }
    enqueueChildren(candidate, pending)
  }
}
