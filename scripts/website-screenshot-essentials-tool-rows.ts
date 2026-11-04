import { HIVE_TOOL_NAME } from '@shared/constants/hive'

/** The seeded Queen's one finished turn: each kind of tool row the docs describe. */

export const TOOL_ROWS_WORKER_TITLE = 'Add a regression test for 4xx uploads'
export const MINUTE_MS = 60_000
const TOOL_ROWS_STARTED_MS = 3 * MINUTE_MS
export const TOOL_ROWS_UPDATED_MS = 2 * MINUTE_MS
export const TOOL_ROWS_ASSISTANT_ID = 'website-essentials-tools-assistant'
export const TOOL_ROWS_ALTERNATE_ID = 'website-essentials-tools-alternate'
const TEST_DURATION_MS = 1_840
const READ_DURATION_MS = 12
const EDIT_DURATION_MS = 31
const LOGS_DURATION_MS = 2_260
const SPAWN_DURATION_MS = 420
const RETRY_CHANGE_LINE = 17

const TEST_OUTPUT = [
  ' RUN  v3.2.4 fieldnotes',
  '',
  ' ✓ src/upload/__tests__/retry.test.ts (6 tests) 112ms',
  '',
  ' Test Files  1 passed (1)',
  '      Tests  6 passed (6)',
].join('\n')

const RETRY_PATCH = [
  '--- a/src/upload/retry.ts',
  '+++ b/src/upload/retry.ts',
  `@@ -${String(RETRY_CHANGE_LINE - 2)},5 +${String(RETRY_CHANGE_LINE - 2)},6 @@`,
  '     try {',
  '       const response = await upload()',
  '-      if (response.status < 500) return response',
  '+      if (response.ok) return response',
  '+      if (response.status < 500) return response',
  '       lastError = new Error(`Upload failed with ${response.status}`)',
  '     } catch (error) {',
  '',
].join('\n')

const RETRY_DISPLAY_DIFF = [
  `  ${String(RETRY_CHANGE_LINE - 2)}     try {`,
  `  ${String(RETRY_CHANGE_LINE - 1)}       const response = await upload()`,
  `-${String(RETRY_CHANGE_LINE)}       if (response.status < 500) return response`,
  `+${String(RETRY_CHANGE_LINE)}       if (response.ok) return response`,
  `+${String(RETRY_CHANGE_LINE + 1)}       if (response.status < 500) return response`,
  `  ${String(RETRY_CHANGE_LINE + 2)}       lastError = new Error(\`Upload failed with \${response.status}\`)`,
].join('\n')

const LOG_SUMMARY = [
  'service:fieldnotes-api @route:/attachments, last 7 days',
  '  status 503  412 events  (retried, 97% succeeded on the next attempt)',
  '  status 413   88 events  (retried 3 times each, never succeeded)',
  '  status 401   23 events  (retried 3 times each, never succeeded)',
].join('\n')

function textResult(text: string) {
  return { content: [{ type: 'text', text }] }
}

interface ToolStep {
  readonly id: string
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
  readonly result: unknown
  readonly isError?: boolean
  readonly duration: number
}

function toolParts(step: ToolStep) {
  return [
    { type: 'tool-call', toolCall: { id: step.id, name: step.name, args: step.args } },
    {
      type: 'tool-result',
      toolResult: {
        id: step.id,
        name: step.name,
        args: step.args,
        result: step.result,
        isError: step.isError ?? false,
        duration: step.duration,
      },
    },
  ]
}

/**
 * The tool rows of one turn, each kind the conversation guide describes: a finished shell
 * command, a failed read, an edit with its diff, an MCP tool, and a Worker spawn with **Open**
 * (its result names the Worker, which only exists once the Hive is seeded).
 */
export function toolRowsAssistantParts(workerSessionId: string) {
  const steps: readonly ToolStep[] = [
    {
      id: 'website-essentials-test',
      name: 'bash',
      args: { command: 'pnpm test -- src/upload' },
      result: textResult(TEST_OUTPUT),
      duration: TEST_DURATION_MS,
    },
    {
      id: 'website-essentials-read',
      name: 'read',
      args: { path: 'src/upload/policy.ts' },
      result: textResult("ENOENT: no such file or directory, access 'src/upload/policy.ts'"),
      isError: true,
      duration: READ_DURATION_MS,
    },
    {
      id: 'website-essentials-edit',
      name: 'edit',
      args: {
        path: 'src/upload/retry.ts',
        edits: [
          {
            oldText: '      if (response.status < 500) return response',
            newText:
              '      if (response.ok) return response\n      if (response.status < 500) return response',
          },
        ],
      },
      result: {
        ...textResult('Successfully replaced 1 block in src/upload/retry.ts.'),
        details: {
          diff: RETRY_DISPLAY_DIFF,
          patch: RETRY_PATCH,
          firstChangedLine: RETRY_CHANGE_LINE,
        },
      },
      duration: EDIT_DURATION_MS,
    },
    {
      id: 'website-essentials-logs',
      name: 'mcp__datadog__search_datadog_logs',
      args: { query: 'service:fieldnotes-api @route:/attachments status:error', from: 'now-7d' },
      result: textResult(LOG_SUMMARY),
      duration: LOGS_DURATION_MS,
    },
    {
      id: 'website-essentials-spawn',
      name: HIVE_TOOL_NAME,
      args: {
        action: 'spawn',
        title: TOOL_ROWS_WORKER_TITLE,
        objective:
          'Add a regression test proving uploadWithRetry returns a 4xx response without retrying.',
        workspace: 'share-parent',
      },
      result: textResult(JSON.stringify({ response: { outcome: { sessionId: workerSessionId } } })),
      duration: SPAWN_DURATION_MS,
    },
  ]
  return [
    { type: 'text', text: 'I’ll run the upload tests first, then look at the retry rules.' },
    ...steps.flatMap(toolParts),
    {
      type: 'text',
      text: [
        'Uploads now stop retrying client errors. The logs show why it matters: 413 and 401 responses were retried three times each and never succeeded.',
        '',
        'A Worker is adding a regression test for that case.',
      ].join('\n'),
    },
  ]
}

export function toolRowsMessages(now: number) {
  return [
    {
      id: 'website-essentials-tools-user',
      role: 'user',
      createdAt: now - TOOL_ROWS_STARTED_MS,
      parts: [
        {
          type: 'text',
          text: 'Stop retrying uploads that fail with a client error, and check how often uploads failed in production this week.',
        },
      ],
    },
    {
      id: TOOL_ROWS_ASSISTANT_ID,
      role: 'assistant',
      model: 'gpt-5.4',
      createdAt: now - TOOL_ROWS_UPDATED_MS,
      parts: toolRowsAssistantParts(''),
    },
  ]
}
