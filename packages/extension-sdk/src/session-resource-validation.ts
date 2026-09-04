import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { isNonEmptyString, isRecord } from './internal-validation.js'
import type {
  ExtensionSessionResourceListResult,
  ExtensionSessionResourcePublishResult,
  ExtensionSessionResourceView,
} from './session-resource-types.js'

const SESSION_RESOURCE_KINDS: ReadonlySet<string> = new Set([
  'image',
  'file',
  'link',
  'tool',
  'web-search',
  'site',
  'commit',
  'change-request',
])

function isResourceKind(value: unknown): value is ExtensionSessionResourceView['kind'] {
  return typeof value === 'string' && SESSION_RESOURCE_KINDS.has(value)
}

function isOccurrence(value: unknown) {
  return (
    isRecord(value) &&
    (value.actor === 'user' ||
      value.actor === 'agent' ||
      value.actor === 'tool' ||
      value.actor === 'extension') &&
    (value.activity === 'provided' ||
      value.activity === 'read' ||
      value.activity === 'created' ||
      value.activity === 'updated') &&
    (value.label === null || typeof value.label === 'string') &&
    typeof value.createdAt === 'number'
  )
}

function isResource(value: unknown): value is ExtensionSessionResourceView {
  return (
    isRecord(value) &&
    isNonEmptyString(value.resourceId) &&
    isResourceKind(value.kind) &&
    typeof value.title === 'string' &&
    (value.mimeType === null || typeof value.mimeType === 'string') &&
    typeof value.available === 'boolean' &&
    typeof value.source === 'boolean' &&
    typeof value.output === 'boolean' &&
    Array.isArray(value.occurrences) &&
    value.occurrences.every(isOccurrence) &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  )
}

function hasResultBase(value: Readonly<Record<string, unknown>>) {
  return (
    isNonEmptyString(value.extensionId) &&
    isNonEmptyString(value.contributionId) &&
    value.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES &&
    isNonEmptyString(value.sessionId)
  )
}

export function isSessionResourcePublishResult(
  value: unknown,
): value is ExtensionSessionResourcePublishResult {
  return (
    isRecord(value) &&
    hasResultBase(value) &&
    value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE &&
    isResource(value.resource)
  )
}

export function isSessionResourceListResult(
  value: unknown,
): value is ExtensionSessionResourceListResult {
  return (
    isRecord(value) &&
    hasResultBase(value) &&
    value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES &&
    (value.category === 'all' || value.category === 'sources' || value.category === 'outputs') &&
    typeof value.total === 'number' &&
    Number.isInteger(value.total) &&
    value.total >= 0 &&
    Array.isArray(value.resources) &&
    value.resources.every(isResource)
  )
}
