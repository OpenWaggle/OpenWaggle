/**
 * The documentation discovery types, each inferred from its internal schema and printed into
 * `src/generated/docs.ts` by `scripts/generate-extension-sdk-types.ts`.
 */
import type * as Docs from '../docs-schemas.js'
import type { SchemaType } from '../schema.js'

export type ExtensionDocsDiscoverPayload = SchemaType<
  typeof Docs.extensionDocsDiscoverPayloadSchema
>
export type ExtensionDocsResolveTopicPayload = SchemaType<
  typeof Docs.extensionDocsResolveTopicPayloadSchema
>
export type ExtensionDocsDiscoverResult = SchemaType<typeof Docs.extensionDocsDiscoverResultSchema>
export type ExtensionDocsResolveTopicResult = SchemaType<
  typeof Docs.extensionDocsResolveTopicResultSchema
>
export type ExtensionDocsDiscoveryView = SchemaType<typeof Docs.docsDiscoveryViewSchema>
export type FirstPartyDocsTopicSummary = SchemaType<typeof Docs.firstPartyDocsTopicSummarySchema>
