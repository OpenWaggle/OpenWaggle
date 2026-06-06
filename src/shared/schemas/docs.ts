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

export type InstalledDocsTopic = SchemaType<typeof installedDocsTopicSchema>
export type InstalledDocsManifest = SchemaType<typeof installedDocsManifestSchema>
