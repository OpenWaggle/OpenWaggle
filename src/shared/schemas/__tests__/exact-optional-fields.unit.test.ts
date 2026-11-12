import { type Schema, safeDecodeUnknown } from '@shared/schema'
import { describe, expect, it } from 'vitest'
import { confirmResponseSchema } from '../agent-loop-interaction'
import { worktreeLaunchProgressSchema } from '../background-run'
import { browserPreviewShortcutBindingsSchema } from '../browser-preview'
import { extensionFrameRegisterInputSchema } from '../extension-frame'
import { gitCommitPayloadSchema, gitRunStackedActionOptionsSchema } from '../git-requests'
import { mcpRegistrySearchRequestSchema } from '../mcp-registry'
import { nestedToolCallsSchema } from '../nested-tool-calls'
import { projectActionShortcutSchema } from '../project-actions'
import { shortcutBindingSchema } from '../settings-shortcuts'
import { agentTransportCompactionEndEventSchema } from '../stream'
import {
  agentSendPayloadSchema,
  preparedAttachmentSchema,
  projectSettingsFileSchema,
} from '../validation'
import { voiceTranscriptionRequestSchema } from '../voice'

interface ExactFieldCase {
  readonly name: string
  readonly decodes: (value: unknown) => boolean
  /** A value that decodes with the optional field left out. */
  readonly valid: unknown
  /** The same value with the optional field present and set to `undefined`. */
  readonly withUndefined: unknown
}

function decodes<A, I>(schema: Schema.Schema<A, I>) {
  return (value: unknown) => safeDecodeUnknown(schema, value).success
}

function exactField<A, I>(
  name: string,
  schema: Schema.Schema<A, I>,
  valid: object,
  field: string,
): ExactFieldCase {
  return {
    name: `${name}.${field}`,
    decodes: decodes(schema),
    valid,
    withUndefined: { ...valid, [field]: undefined },
  }
}

const attachment = {
  id: 'attachment-1',
  kind: 'text',
  name: 'notes.txt',
  path: '/tmp/notes.txt',
  mimeType: 'text/plain',
  sizeBytes: 1,
  extractedText: 'x',
}

const cases: readonly ExactFieldCase[] = [
  exactField('shortcutBinding', shortcutBindingSchema, { key: 'k' }, 'mod'),
  exactField('projectActionShortcut', projectActionShortcutSchema, { key: 'k' }, 'meta'),
  {
    name: 'browserPreviewShortcutBindings[].shift',
    decodes: decodes(browserPreviewShortcutBindingsSchema),
    valid: [{ key: 'k' }],
    withUndefined: [{ key: 'k', shift: undefined }],
  },
  exactField(
    'gitCommitPayload',
    gitCommitPayloadSchema,
    { message: 'm', amend: false, paths: [] },
    'sessionId',
  ),
  exactField(
    'gitRunStackedActionOptions',
    gitRunStackedActionOptionsSchema,
    { action: 'commit' },
    'baseRef',
  ),
  exactField('agentSendPayload', agentSendPayloadSchema, { text: 'hi', attachments: [] }, 'waggle'),
  exactField('preparedAttachment', preparedAttachmentSchema, attachment, 'origin'),
  exactField('projectSettingsFile', projectSettingsFileSchema, {}, 'preferences'),
  exactField(
    'confirmResponse',
    confirmResponseSchema,
    { kind: 'confirm', accepted: true },
    'scope',
  ),
  exactField(
    'nestedToolCalls',
    nestedToolCallsSchema,
    { calls: [], complete: true },
    'droppedCalls',
  ),
  exactField('mcpRegistrySearchRequest', mcpRegistrySearchRequestSchema, { query: 'q' }, 'limit'),
  exactField(
    'worktreeLaunchProgress',
    worktreeLaunchProgressSchema,
    { stage: 'fetching-base', details: [] },
    'label',
  ),
  exactField(
    'voiceTranscriptionRequest',
    voiceTranscriptionRequestSchema,
    { pcm16: new Uint8Array([1, 2]), sampleRate: 16_000 },
    'language',
  ),
  exactField(
    'extensionFrameRegisterInput',
    extensionFrameRegisterInputSchema,
    { frameId: 'frame-1', bootstrapUrl: 'openwaggle-extension://frame' },
    'networkOrigins',
  ),
  exactField(
    'agentTransportCompactionEndEvent',
    agentTransportCompactionEndEventSchema,
    {
      type: 'compaction_end',
      timestamp: 1,
      reason: 'manual',
      result: null,
      aborted: false,
      willRetry: false,
    },
    'errorMessage',
  ),
]

describe('exact optional fields', () => {
  it.each(cases)('$name decodes when left out and refuses an explicit undefined', (testCase) => {
    expect(testCase.decodes(testCase.valid)).toBe(true)
    expect(testCase.decodes(testCase.withUndefined)).toBe(false)
  })
})
