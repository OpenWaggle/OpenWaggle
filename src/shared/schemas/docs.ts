import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema, type SchemaType } from '@shared/schema'

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))
const EXTENSION_TOPIC_PREFIX = 'extension:'

export const firstPartyDocTopicSchema = nonEmptyStringSchema.pipe(
  Schema.filter(
    (value) =>
      !value.startsWith(EXTENSION_TOPIC_PREFIX) ||
      'Extension docs topics must be resolved through extension docs discovery.',
  ),
)

export const docsListInputSchema = Schema.Struct({
  projectPaths: Schema.optional(Schema.mutable(Schema.Array(nonEmptyStringSchema))),
  includeExtensions: Schema.optional(Schema.Boolean),
})

export const docsResolveTopicInputSchema = Schema.Struct({
  topic: firstPartyDocTopicSchema,
})

export const docsDiscoveryDiagnosticSchema = Schema.Struct({
  severity: Schema.Literal('warning', 'error'),
  code: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  path: Schema.optional(nonEmptyStringSchema),
})

export const installedDocsGroupSchema = Schema.Struct({
  id: Schema.Literal('openwaggle', 'pi'),
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
})

export const installedDocsTopicSchema = Schema.Struct({
  topic: firstPartyDocTopicSchema,
  source: Schema.Literal('openwaggle', 'pi'),
  group: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  description: Schema.optional(nonEmptyStringSchema),
  section: Schema.optional(nonEmptyStringSchema),
  order: Schema.Number,
  sourcePath: nonEmptyStringSchema,
  bundlePath: nonEmptyStringSchema,
  aliases: Schema.mutable(Schema.Array(nonEmptyStringSchema)),
  keywords: Schema.mutable(Schema.Array(nonEmptyStringSchema)),
  contentHash: nonEmptyStringSchema,
})

export const installedDocsManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: nonEmptyStringSchema,
  readmePath: nonEmptyStringSchema,
  groups: Schema.mutable(Schema.Array(installedDocsGroupSchema)),
  topics: Schema.mutable(Schema.Array(installedDocsTopicSchema)),
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
  extensionId: nonEmptyStringSchema,
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

export const docsResolveTopicResultSchema = Schema.NullOr(firstPartyDocsTopicSummarySchema)

export type InstalledDocsTopic = SchemaType<typeof installedDocsTopicSchema>
export type InstalledDocsManifest = SchemaType<typeof installedDocsManifestSchema>
