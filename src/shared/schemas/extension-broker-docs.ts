import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { Schema, type SchemaType } from '@shared/schema'
import {
  docsDiscoveryViewSchema,
  docsListInputSchema,
  docsResolveTopicInputSchema,
  docsResolveTopicResultSchema,
} from '@shared/schemas/docs'
import { extensionContributionIdSchema, extensionIdSchema } from './extensions'

export const extensionDocsDiscoverPayloadSchema = docsListInputSchema

export const extensionDocsResolveTopicPayloadSchema = docsResolveTopicInputSchema

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
  resolvedTopic: docsResolveTopicResultSchema,
})

export type ExtensionDocsDiscoverPayload = SchemaType<typeof extensionDocsDiscoverPayloadSchema>
export type ExtensionDocsResolveTopicPayload = SchemaType<
  typeof extensionDocsResolveTopicPayloadSchema
>
export type ExtensionDocsDiscoverResult = SchemaType<typeof extensionDocsDiscoverResultSchema>
export type ExtensionDocsResolveTopicResult = SchemaType<
  typeof extensionDocsResolveTopicResultSchema
>
