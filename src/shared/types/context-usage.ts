import type { SchemaType } from '@shared/schema'
import type {
  contextCompactionResultSchema,
  contextUsageSnapshotSchema,
  sessionUsageSummarySchema,
} from '@shared/schemas/context-usage'

export type SessionUsageSummary = SchemaType<typeof sessionUsageSummarySchema>
export type ContextUsageSnapshot = SchemaType<typeof contextUsageSnapshotSchema>
export type ContextCompactionResult = SchemaType<typeof contextCompactionResultSchema>
