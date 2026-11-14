import { firstPartyDocTopicSchema } from '@openwaggle/extension-sdk/internal/docs-schemas'
import { Schema } from '@shared/schema'

// The docs views extensions read through the broker are the public SDK contract.
export { firstPartyDocTopicSchema } from '@openwaggle/extension-sdk/internal/docs-schemas'

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

export const docsListInputSchema = Schema.Struct({
  projectPaths: Schema.optionalWith(Schema.mutable(Schema.Array(nonEmptyStringSchema)), {
    exact: true,
  }),
  includeExtensions: Schema.optionalWith(Schema.Boolean, { exact: true }),
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
  description: Schema.optionalWith(nonEmptyStringSchema, { exact: true }),
  section: Schema.optionalWith(nonEmptyStringSchema, { exact: true }),
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
