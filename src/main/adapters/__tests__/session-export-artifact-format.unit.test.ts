import { SESSION_EXPORT_SCHEMA_VERSION } from '@shared/types/session-export'
import { describe, expect, it } from 'vitest'
import { serializeExportRecords } from '../session-export-artifact-format'

function nodeRecord(input: {
  readonly nodeId: string
  readonly metadata: unknown
  readonly text: string
}) {
  return {
    record: 'node' as const,
    schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
    sessionId: 'session-queen',
    nodeId: input.nodeId,
    parentNodeId: null,
    branchHintId: null,
    role: 'user',
    kind: 'user_message',
    timestampMs: 1,
    createdOrder: 1,
    content: { parts: [{ type: 'text', text: input.text }] },
    metadata: input.metadata,
  }
}

describe('Session export file, Markdown', () => {
  it('heads the Host’s Hive wake notice as hive, not as the user', () => {
    const markdown = serializeExportRecords('markdown', [
      nodeRecord({ nodeId: 'node-user', metadata: {}, text: 'Draft the epics' }),
      nodeRecord({
        nodeId: 'node-wake',
        metadata: { hiveWake: true },
        text: 'Worker updates arrived',
      }),
    ])

    expect(markdown.match(/^## .+$/gm)).toEqual(['## user', '## hive'])
  })
})
