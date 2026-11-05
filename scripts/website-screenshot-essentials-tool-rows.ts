import path from 'node:path'
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
/** The new line 18 adds the 4xx early return after line 17's `response.ok` check. */
const RETRY_CHANGE_LINE = 18

const TEST_OUTPUT = [
  ' RUN  v3.2.4 jotter',
  '',
  ' ✓ src/upload/__tests__/retry.test.ts (6 tests) 112ms',
  '',
  ' Test Files  1 passed (1)',
  '      Tests  6 passed (6)',
].join('\n')

// Pi's edit output for adding the 4xx early return: `generateUnifiedPatch` and
// `generateDiffString` from its edit-diff module, both with 4 lines of context.
const RETRY_CONTEXT_BEFORE = [
  '  for (let attempt = 0; attempt < options.attempts; attempt += 1) {',
  '    try {',
  '      const response = await upload()',
  '      if (response.ok) return response',
]
const RETRY_ADDED_LINE = '      if (response.status < 500) return response'
const RETRY_CONTEXT_AFTER = [
  '      lastError = new Error(`Upload failed with ${response.status}`)',
  '    } catch (error) {',
  '      lastError = error',
  '    }',
]
const RETRY_HUNK_START = RETRY_CHANGE_LINE - RETRY_CONTEXT_BEFORE.length
const RETRY_HUNK_OLD_LINES = RETRY_CONTEXT_BEFORE.length + RETRY_CONTEXT_AFTER.length

const RETRY_PATCH = [
  '--- src/upload/retry.ts',
  '+++ src/upload/retry.ts',
  `@@ -${String(RETRY_HUNK_START)},${String(RETRY_HUNK_OLD_LINES)} +${String(RETRY_HUNK_START)},${String(RETRY_HUNK_OLD_LINES + 1)} @@`,
  ...RETRY_CONTEXT_BEFORE.map((line) => ` ${line}`),
  `+${RETRY_ADDED_LINE}`,
  ...RETRY_CONTEXT_AFTER.map((line) => ` ${line}`),
  '',
].join('\n')

const RETRY_DISPLAY_DIFF = [
  '    ...',
  ...RETRY_CONTEXT_BEFORE.map((line, index) => ` ${String(RETRY_HUNK_START + index)} ${line}`),
  `+${String(RETRY_CHANGE_LINE)} ${RETRY_ADDED_LINE}`,
  ...RETRY_CONTEXT_AFTER.map((line, index) => ` ${String(RETRY_CHANGE_LINE + index)} ${line}`),
  '    ...',
].join('\n')

const LOG_SUMMARY = [
  'service:jotter-api @route:/attachments, last 7 days',
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
export function toolRowsAssistantParts(workerSessionId: string, projectPath: string) {
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
      // Pi reports the absolute path it resolved against the Session's working directory.
      result: textResult(
        `ENOENT: no such file or directory, access '${path.join(projectPath, 'src/upload/policy.ts')}'`,
      ),
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
            oldText: '      if (response.ok) return response',
            newText: `      if (response.ok) return response\n${RETRY_ADDED_LINE}`,
          },
        ],
      },
      result: {
        ...textResult('Successfully replaced 1 block(s) in src/upload/retry.ts.'),
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
      args: { query: 'service:jotter-api @route:/attachments status:error', from: 'now-7d' },
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

export function toolRowsMessages(now: number, projectPath: string) {
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
      parts: toolRowsAssistantParts('', projectPath),
    },
  ]
}
