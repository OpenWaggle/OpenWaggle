import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { extensionContributionIdSchema, extensionIdSchema } from './manifest.js'
import type { SchemaType } from './schema.js'

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))
const EXTENSION_TOPIC_PREFIX = 'extension:'

export const firstPartyDocTopicSchema = nonEmptyStringSchema.pipe(
  Schema.filter(
    (value) =>
      !value.startsWith(EXTENSION_TOPIC_PREFIX) ||
      'Extension docs topics must be resolved through extension docs discovery.',
  ),
)

export const extensionDocsDiscoverPayloadSchema = Schema.Struct({
  projectPaths: Schema.optional(Schema.Array(nonEmptyStringSchema)),
  includeExtensions: Schema.optional(Schema.Boolean),
})

export const extensionDocsResolveTopicPayloadSchema = Schema.Struct({
  topic: firstPartyDocTopicSchema,
})

export const docsDiscoveryDiagnosticSchema = Schema.Struct({
  severity: Schema.Literal('warning', 'error'),
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  path: Schema.optional(nonEmptyStringSchema),
})

export const firstPartyDocsTopicSummarySchema = Schema.Struct({
  topic: firstPartyDocTopicSchema,
  source: Schema.Literal('openwaggle', 'pi'),
  group: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  description: Schema.optional(nonEmptyStringSchema),
  section: Schema.optional(nonEmptyStringSchema),
  order: Schema.Number,
  path: nonEmptyStringSchema,
  bundlePath: nonEmptyStringSchema,
  sourcePath: nonEmptyStringSchema,
  aliases: Schema.Array(nonEmptyStringSchema),
  keywords: Schema.Array(nonEmptyStringSchema),
  contentHash: nonEmptyStringSchema,
})

export const extensionDocsPackageScopeViewSchema = Schema.Struct({
  kind: Schema.Literal(
    OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
    OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
  ),
  label: nonEmptyStringSchema,
  projectPath: Schema.optional(nonEmptyStringSchema),
})

export const extensionDocsProvenanceSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  extensionName: Schema.NullOr(nonEmptyStringSchema),
  extensionVersion: Schema.NullOr(nonEmptyStringSchema),
  scope: extensionDocsPackageScopeViewSchema,
  packagePath: nonEmptyStringSchema,
  manifestPath: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  packageContentHash: Schema.NullOr(nonEmptyStringSchema),
  trust: Schema.Literal('trusted', 'untrusted', 'unknown'),
  lifecycle: Schema.Literal('enabled', 'disabled', 'unavailable'),
})

export const extensionDocsTopicSummarySchema = Schema.Struct({
  topic: nonEmptyStringSchema,
  localTopic: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  description: Schema.optional(nonEmptyStringSchema),
  path: nonEmptyStringSchema,
  aliases: Schema.Array(nonEmptyStringSchema),
  keywords: Schema.Array(nonEmptyStringSchema),
  contentHash: Schema.NullOr(nonEmptyStringSchema),
  provenance: extensionDocsProvenanceSchema,
  diagnostics: Schema.Array(docsDiscoveryDiagnosticSchema),
})

export const docsDiscoveryViewSchema = Schema.Struct({
  generatedAt: nonEmptyStringSchema,
  bundlePath: nonEmptyStringSchema,
  firstPartyTopics: Schema.Array(firstPartyDocsTopicSummarySchema),
  extensionTopics: Schema.Array(extensionDocsTopicSummarySchema),
  diagnostics: Schema.Array(docsDiscoveryDiagnosticSchema),
})

export const extensionDocsDiscoverResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS),
  docs: docsDiscoveryViewSchema,
})

export const extensionDocsResolveTopicResultSchema = Schema.Struct({
  extensionId: extensionIdSchema,
  contributionId: extensionContributionIdSchema,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS),
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC),
  resolvedTopic: Schema.NullOr(firstPartyDocsTopicSummarySchema),
})

export type ExtensionDocsDiscoverPayload = SchemaType<typeof extensionDocsDiscoverPayloadSchema>
export type ExtensionDocsResolveTopicPayload = SchemaType<
  typeof extensionDocsResolveTopicPayloadSchema
>
export type ExtensionDocsDiscoverResult = SchemaType<typeof extensionDocsDiscoverResultSchema>
export type ExtensionDocsResolveTopicResult = SchemaType<
  typeof extensionDocsResolveTopicResultSchema
>
export type ExtensionDocsDiscoveryView = SchemaType<typeof docsDiscoveryViewSchema>
export type FirstPartyDocsTopicSummary = SchemaType<typeof firstPartyDocsTopicSummarySchema>
