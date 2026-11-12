import type { SchemaType } from '@shared/schema'
import type {
  contextCompactionResultSchema,
  contextUsageSnapshotSchema,
  sessionModelUsageSchema,
  sessionUsageSummarySchema,
} from '@shared/schemas/context-usage'

/** Inferred from the schemas in `@shared/schemas/context-usage`. */
export type SessionModelUsage = SchemaType<typeof sessionModelUsageSchema>
export type SessionUsageSummary = SchemaType<typeof sessionUsageSummarySchema>
export type ContextUsageSnapshot = SchemaType<typeof contextUsageSnapshotSchema>
export type ContextCompactionResult = SchemaType<typeof contextCompactionResultSchema>
