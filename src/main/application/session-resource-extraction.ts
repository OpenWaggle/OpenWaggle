import { isRecord } from '@shared/utils/validation'
import {
  type CapturedImage,
  type CapturedLink,
  type CapturedResourceOrder,
  type CapturedSite,
  SESSION_RESOURCE_EXTRACTION_LIMITS,
} from './session-resource-extraction-types'
import { collectMarkdownResources } from './session-resource-markdown-extraction'

export {
  type CapturedGeneratedImage,
  type CapturedImage,
  type CapturedLink,
  type CapturedLocalImage,
  type CapturedResourceOrder,
  type CapturedSite,
  SESSION_RESOURCE_EXTRACTION_LIMITS,
} from './session-resource-extraction-types'

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

function collectGeneratedImageRecord(
  candidate: Readonly<Record<string, unknown>>,
  images: CapturedImage[],
  order: CapturedResourceOrder[],
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
    order.push({ kind: 'image', index: images.length })
    images.push({ data: candidate.data, mimeType: candidate.mimeType, title: boundedTitle })
  }
  return { consumed, handled: true }
}

function collectSiteRecord(
  candidate: Readonly<Record<string, unknown>>,
  sites: CapturedSite[],
  remainingTextCharacters: number,
) {
  if (candidate.type !== 'site') return null
  const rawUrl = typeof candidate.url === 'string' ? candidate.url : candidate.uri
  if (typeof rawUrl !== 'string') return { consumed: 0, handled: true }
  const url = supportedHttpUrl(rawUrl)
  const rawTitle = typeof candidate.title === 'string' ? candidate.title.trim() : rawUrl
  const title = rawTitle.slice(0, SESSION_RESOURCE_EXTRACTION_LIMITS.maxTitleCharacters)
  const consumed = Math.min(rawUrl.length + rawTitle.length, remainingTextCharacters)
  if (
    url &&
    title.length > 0 &&
    consumed === rawUrl.length + rawTitle.length &&
    sites.length < SESSION_RESOURCE_EXTRACTION_LIMITS.maxSites
  ) {
    sites.push({
      url,
      title,
      activity: candidate.activity === 'updated' ? 'updated' : 'created',
    })
  }
  return { consumed, handled: true }
}

function collectResourceLinkRecord(
  candidate: Readonly<Record<string, unknown>>,
  links: CapturedLink[],
  order: CapturedResourceOrder[],
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
    order.push({ kind: 'link', index: links.length })
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
  sites: CapturedSite[],
  order: CapturedResourceOrder[],
  remainingTextCharacters: number,
) {
  return (
    collectGeneratedImageRecord(candidate, images, order, remainingTextCharacters) ??
    collectSiteRecord(candidate, sites, remainingTextCharacters) ??
    collectResourceLinkRecord(candidate, links, order, remainingTextCharacters) ?? {
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
  const sites: CapturedSite[] = []
  const order: CapturedResourceOrder[] = []
  const seen = new WeakSet<object>()
  const pending: unknown[] = [value]
  let scheduled = 1
  let remainingTextCharacters = SESSION_RESOURCE_EXTRACTION_LIMITS.maxTextCharacters

  while (pending.length > 0) {
    const candidate = pending.pop()
    if (typeof candidate === 'string') {
      const consumed = Math.min(candidate.length, remainingTextCharacters)
      if (consumed > 0) collectMarkdownResources(candidate.slice(0, consumed), images, links, order)
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
    const collected = collectRecord(candidate, images, links, sites, order, remainingTextCharacters)
    remainingTextCharacters -= collected.consumed
    if (!collected.handled) {
      scheduled = enqueueRecord(candidate, pending, scheduled)
    }
  }
  return { images, links, sites, order }
}
