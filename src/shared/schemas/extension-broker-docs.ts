import type { SchemaType } from '@shared/schema'
import { docsListInputSchema, docsResolveTopicInputSchema } from '@shared/schemas/docs'

// The docs results are the public extension SDK's, as the rest of the broker contract.

export const extensionDocsDiscoverPayloadSchema = docsListInputSchema

export const extensionDocsResolveTopicPayloadSchema = docsResolveTopicInputSchema

export type ExtensionDocsDiscoverPayload = SchemaType<typeof extensionDocsDiscoverPayloadSchema>
