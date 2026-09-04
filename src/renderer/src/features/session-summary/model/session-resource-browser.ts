import { match } from '@diegogbrisa/ts-match'
import type {
  SessionResource,
  SessionResourceActivity,
  SessionResourceActor,
  SessionResourceKind,
  SessionResourceOccurrence,
} from '@shared/types/session-resource'

export type SessionResourceBrowserView = 'sources' | 'outputs'

export interface SessionResourceBrowserTarget {
  readonly view: SessionResourceBrowserView
  readonly resourceId?: string
}

export const DEFAULT_SESSION_RESOURCE_BROWSER_TARGET: SessionResourceBrowserTarget = {
  view: 'sources',
}

interface SessionResourceCategory {
  readonly id: string
  readonly label: string
}

export interface SessionResourceGroup extends SessionResourceCategory {
  readonly resources: readonly SessionResource[]
}

const IMAGES = { id: 'images', label: 'Images' }
const FILES = { id: 'files', label: 'Files' }
const LINKS_AND_SITES = { id: 'links-sites', label: 'Links & sites' }
const LINKS = { id: 'links', label: 'Links' }
const TOOLS = { id: 'tools', label: 'Tools' }
const WEB_SEARCHES = { id: 'web-searches', label: 'Web searches' }
const SITES = { id: 'sites', label: 'Sites' }
const COMMITS = { id: 'commits', label: 'Commits' }
const CHANGE_REQUESTS = { id: 'change-requests', label: 'Change requests' }

const SOURCE_CATEGORY_ORDER: readonly SessionResourceCategory[] = [
  IMAGES,
  FILES,
  LINKS_AND_SITES,
  TOOLS,
  WEB_SEARCHES,
  COMMITS,
  CHANGE_REQUESTS,
]

const OUTPUT_CATEGORY_ORDER: readonly SessionResourceCategory[] = [
  IMAGES,
  FILES,
  SITES,
  COMMITS,
  CHANGE_REQUESTS,
  LINKS,
  TOOLS,
  WEB_SEARCHES,
]

function sourceCategory(kind: SessionResourceKind): SessionResourceCategory {
  return match(kind)
    .with('image', () => IMAGES)
    .with('file', () => FILES)
    .with('link', 'site', () => LINKS_AND_SITES)
    .with('tool', () => TOOLS)
    .with('web-search', () => WEB_SEARCHES)
    .with('commit', () => COMMITS)
    .with('change-request', () => CHANGE_REQUESTS)
    .exhaustive()
}

function outputCategory(kind: SessionResourceKind): SessionResourceCategory {
  return match(kind)
    .with('image', () => IMAGES)
    .with('file', () => FILES)
    .with('link', () => LINKS)
    .with('tool', () => TOOLS)
    .with('web-search', () => WEB_SEARCHES)
    .with('site', () => SITES)
    .with('commit', () => COMMITS)
    .with('change-request', () => CHANGE_REQUESTS)
    .exhaustive()
}

export function groupSessionResources(
  resources: readonly SessionResource[],
  view: SessionResourceBrowserView,
): readonly SessionResourceGroup[] {
  const order = view === 'sources' ? SOURCE_CATEGORY_ORDER : OUTPUT_CATEGORY_ORDER
  const resourcesByCategory = new Map<string, SessionResource[]>()
  for (const resource of resources) {
    const category =
      view === 'sources' ? sourceCategory(resource.kind) : outputCategory(resource.kind)
    const existing = resourcesByCategory.get(category.id)
    if (existing) existing.push(resource)
    else resourcesByCategory.set(category.id, [resource])
  }
  return order.flatMap((category) => {
    const categoryResources = resourcesByCategory.get(category.id)
    return categoryResources ? [{ ...category, resources: categoryResources }] : []
  })
}

function occurrenceMatchesView(
  occurrence: SessionResourceOccurrence,
  view: SessionResourceBrowserView,
) {
  return view === 'sources'
    ? occurrence.activity === 'provided' || occurrence.activity === 'read'
    : occurrence.activity === 'created' || occurrence.activity === 'updated'
}

export function latestResourceOccurrence(
  resource: SessionResource,
  view: SessionResourceBrowserView,
): SessionResourceOccurrence | null {
  let latest: SessionResourceOccurrence | null = null
  for (const occurrence of resource.occurrences) {
    if (!occurrenceMatchesView(occurrence, view)) continue
    if (!latest || occurrence.createdAt > latest.createdAt) latest = occurrence
  }
  return latest
}

function actorLabel(actor: SessionResourceActor, suppliedLabel: string | null) {
  if (suppliedLabel) return suppliedLabel
  return match(actor)
    .with('user', () => 'you')
    .with('agent', () => 'the agent')
    .with('tool', () => 'a tool')
    .with('extension', () => 'an extension')
    .exhaustive()
}

export function resourceProvenanceLabel(
  activity: SessionResourceActivity,
  actor: SessionResourceActor,
  suppliedActorLabel: string | null,
) {
  const subject = actorLabel(actor, suppliedActorLabel)
  return match(activity)
    .with('provided', () => `Provided by ${subject}`)
    .with('read', () => `Read by ${subject}`)
    .with('created', () => `Created by ${subject}`)
    .with('updated', () => `Updated by ${subject}`)
    .exhaustive()
}

export function resourceBranchLabel(branchId: string) {
  const separator = branchId.lastIndexOf(':')
  return separator >= 0 ? branchId.slice(separator + 1) : branchId
}
