import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { isNonEmptyString, isRecord, isStringArray } from './internal-validation.js'
import type { ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicResult } from './types.js'

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isOptionalNonEmptyString(value: unknown) {
  return value === undefined || isNonEmptyString(value)
}

function hasOpenWaggleResultBase(
  value: Readonly<Record<string, unknown>>,
  capability: string,
  method: string,
) {
  return (
    isNonEmptyString(value.extensionId) &&
    isNonEmptyString(value.contributionId) &&
    value.capability === capability &&
    value.method === method
  )
}

function isDocsDiscoveryDiagnostic(value: unknown) {
  return (
    isRecord(value) &&
    (value.severity === 'warning' || value.severity === 'error') &&
    isNonEmptyString(value.code) &&
    isNonEmptyString(value.message) &&
    isOptionalNonEmptyString(value.path)
  )
}

function isFirstPartyDocsTopicSummary(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.topic) &&
    (value.source === 'openwaggle' || value.source === 'pi') &&
    isNonEmptyString(value.group) &&
    isNonEmptyString(value.title) &&
    isOptionalNonEmptyString(value.description) &&
    isOptionalNonEmptyString(value.section) &&
    typeof value.order === 'number' &&
    isNonEmptyString(value.path) &&
    isNonEmptyString(value.bundlePath) &&
    isNonEmptyString(value.sourcePath) &&
    isStringArray(value.aliases) &&
    isStringArray(value.keywords) &&
    isNonEmptyString(value.contentHash)
  )
}

function isExtensionDocsPackageScopeView(value: unknown) {
  return (
    isRecord(value) &&
    (value.kind === 'global' || value.kind === 'project') &&
    isNonEmptyString(value.label) &&
    isOptionalNonEmptyString(value.projectPath)
  )
}

function isExtensionDocsProvenance(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.extensionId) &&
    isStringOrNull(value.extensionName) &&
    isStringOrNull(value.extensionVersion) &&
    isExtensionDocsPackageScopeView(value.scope) &&
    isNonEmptyString(value.packagePath) &&
    isNonEmptyString(value.manifestPath) &&
    isNonEmptyString(value.path) &&
    isStringOrNull(value.packageContentHash) &&
    (value.trust === 'trusted' || value.trust === 'untrusted' || value.trust === 'unknown') &&
    (value.lifecycle === 'enabled' ||
      value.lifecycle === 'disabled' ||
      value.lifecycle === 'unavailable')
  )
}

function isExtensionDocsTopicSummary(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.topic) &&
    isNonEmptyString(value.localTopic) &&
    isNonEmptyString(value.title) &&
    isOptionalNonEmptyString(value.description) &&
    isNonEmptyString(value.path) &&
    isStringArray(value.aliases) &&
    isStringArray(value.keywords) &&
    isStringOrNull(value.contentHash) &&
    isExtensionDocsProvenance(value.provenance) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isDocsDiscoveryDiagnostic)
  )
}

function isDocsDiscoveryView(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.generatedAt) &&
    isNonEmptyString(value.bundlePath) &&
    Array.isArray(value.firstPartyTopics) &&
    value.firstPartyTopics.every(isFirstPartyDocsTopicSummary) &&
    Array.isArray(value.extensionTopics) &&
    value.extensionTopics.every(isExtensionDocsTopicSummary) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isDocsDiscoveryDiagnostic)
  )
}

export function isDocsDiscoverResult(value: unknown): value is ExtensionDocsDiscoverResult {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
    ) &&
    isDocsDiscoveryView(value.docs)
  )
}

export function isDocsResolveTopicResult(value: unknown): value is ExtensionDocsResolveTopicResult {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
    ) &&
    (value.resolvedTopic === null || isFirstPartyDocsTopicSummary(value.resolvedTopic))
  )
}
