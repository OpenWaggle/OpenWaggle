import { canonicalJson } from '@shared/canonical-json'
import type { SessionExportManifest, SessionExportNodeRecord } from '@shared/types/session-export'
import type { SessionExportFormat } from '@shared/types/session-export-operation'

const JSON_INDENT_SPACES = 2

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function markdownContent(content: unknown) {
  if (typeof content === 'string') return content
  if (isRecord(content) && typeof content.text === 'string') return content.text
  return `\`\`\`json\n${JSON.stringify(content, null, JSON_INDENT_SPACES)}\n\`\`\``
}

function markdownManifest(manifest: SessionExportManifest) {
  const queue = manifest.queue
  return (
    `# ${manifest.title}\n\n` +
    `- Export schema: ${manifest.schemaVersion}\n` +
    `- Session: ${manifest.sessionId}\n` +
    `- Scope: ${manifest.branchScope}\n` +
    `- Active branch: ${manifest.activeBranchId ?? 'none'}\n` +
    `- Selected branch: ${manifest.selectedBranchId ?? 'none'}\n` +
    `- Captured: ${new Date(manifest.snapshot.capturedAt).toISOString()}\n` +
    `- Node high-water mark: ${manifest.snapshot.nodeHighWaterMark}\n` +
    `- State revision: ${manifest.snapshot.stateRevision}\n` +
    `- Queue revision: ${manifest.snapshot.queueRevision}\n` +
    `- Active run: ${manifest.activeRunId ?? 'none'}\n` +
    `- Active turn incomplete: ${manifest.activeTurnIncomplete ? 'yes' : 'no'}\n\n` +
    `## Follow-up queue\n\n` +
    `- State: ${queue.state}\n` +
    `- Pending: ${queue.pendingCount}\n` +
    `- Body scope: ${queue.bodyScope}\n` +
    `- Omitted bodies: ${queue.omittedBodyCount}\n\n`
  )
}

function markdownRecord(record: SessionExportNodeRecord) {
  return `## ${record.role ?? 'event'}\n\n${markdownContent(record.content)}\n\n`
}

export function serializeExportManifest(
  format: SessionExportFormat,
  manifest: SessionExportManifest,
) {
  if (format === 'markdown') return markdownManifest(manifest)
  return `${canonicalJson({ record: 'manifest', manifest })}\n`
}

export function serializeExportRecords(
  format: SessionExportFormat,
  records: readonly SessionExportNodeRecord[],
) {
  return format === 'markdown'
    ? records.map(markdownRecord).join('')
    : records.map((record) => `${canonicalJson(record)}\n`).join('')
}
