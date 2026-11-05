import { seedSingleSession } from './support/session-fixtures'
import {
  ANTHROPIC_OPUS,
  CODEMODE_THREAD_TITLE,
  minutesAgo,
} from './website-screenshot-feature-fixture'

const CODEMODE_CALL_ID = 'website-codemode-1'
const CODEMODE_DURATION_MS = 412
const MS_PER_SECOND = 1000
const CODEMODE_PROMPT_MINUTES_AGO = 5
const CODEMODE_SCRIPT_MINUTES_AGO = 4
const CODEMODE_ANSWER_MINUTES_AGO = 3

const CODEMODE_SCRIPT = [
  "const files = ['src/api/client.ts', 'src/api/retry.ts', 'src/api/errors.ts']",
  'const results = await Promise.allSettled(',
  '  files.map((path) => tools.read({ path })),',
  ')',
  "const todos = await tools.grep({ pattern: 'TODO', path: 'src/api' })",
  "const missing = files.filter((_, i) => results[i].status === 'rejected')",
  "return `Not found: ${missing.join(', ')}\\n\\n${todos}`",
].join('\n')

const CODEMODE_MISSING_FILE = 'src/api/errors.ts'

const CODEMODE_CALLS = [
  { name: 'read', args: '{"path":"src/api/client.ts"}', status: 'ok', durationMs: 14 },
  { name: 'read', args: '{"path":"src/api/retry.ts"}', status: 'ok', durationMs: 11 },
  {
    name: 'read',
    args: `{"path":"${CODEMODE_MISSING_FILE}"}`,
    status: 'error',
    durationMs: 3,
    // Pi names the absolute path it resolved. The card shows a call's error as it is, cut to one
    // line, and here that would be the capture's random scratch folder with the file name cut
    // off, so the fixture keeps the path as the script wrote it.
    error: `ENOENT: no such file or directory, access '${CODEMODE_MISSING_FILE}'`,
  },
  { name: 'grep', args: '{"pattern":"TODO","path":"src/api"}', status: 'ok', durationMs: 38 },
].map((call, index) => ({ id: `${CODEMODE_CALL_ID}/${String(index + 1)}`, ...call }))

/**
 * Pi's codemode result: a header block, then the returned string as one text block (the script
 * prints nothing, so there is no `<console_output>` block). Grep names files relative to the
 * directory it searched.
 */
function codemodeResult() {
  const wallTimeSeconds = (CODEMODE_DURATION_MS / MS_PER_SECOND).toFixed(1)
  const returned = [
    `Not found: ${CODEMODE_MISSING_FILE}`,
    '',
    'client.ts:42: // TODO: retry on 429 with Retry-After',
    'client.ts:88: // TODO: surface the request id in thrown errors',
    'retry.ts:17: // TODO: cap total backoff at 30s',
  ].join('\n')
  return {
    content: [
      { type: 'text', text: `Script completed\nWall time ${wallTimeSeconds} seconds\nOutput:\n` },
      { type: 'text', text: returned },
    ],
    details: { calls: CODEMODE_CALLS },
  }
}

/** A transcript with one finished codemode call: four tool calls, one of them failed. */
export async function seedCodemodeSession(userDataDir: string, projectPath: string) {
  const now = Date.now()
  const result = codemodeResult()
  return seedSingleSession(userDataDir, {
    title: CODEMODE_THREAD_TITLE,
    projectPath,
    updatedAt: minutesAgo(now, CODEMODE_ANSWER_MINUTES_AGO),
    executionModel: ANTHROPIC_OPUS,
    messages: [
      {
        id: 'website-codemode-user-1',
        role: 'user',
        createdAt: minutesAgo(now, CODEMODE_PROMPT_MINUTES_AGO),
        parts: [
          {
            type: 'text',
            text: 'Which TODOs are still open in the API client? Group them by file.',
          },
        ],
      },
      {
        id: 'website-codemode-assistant-1',
        role: 'assistant',
        model: 'anthropic/claude-opus-4-6',
        createdAt: minutesAgo(now, CODEMODE_SCRIPT_MINUTES_AGO),
        parts: [
          {
            type: 'tool-call',
            toolCall: { id: CODEMODE_CALL_ID, name: 'codemode', args: { code: CODEMODE_SCRIPT } },
          },
          {
            type: 'tool-result',
            toolResult: {
              id: CODEMODE_CALL_ID,
              name: 'codemode',
              args: { code: CODEMODE_SCRIPT },
              result,
              isError: false,
              duration: CODEMODE_DURATION_MS,
              details: result.details,
            },
          },
        ],
      },
      {
        id: 'website-codemode-assistant-2',
        role: 'assistant',
        model: 'anthropic/claude-opus-4-6',
        createdAt: minutesAgo(now, CODEMODE_ANSWER_MINUTES_AGO),
        parts: [
          {
            type: 'text',
            text: [
              'Three TODOs are open in `src/api`:',
              '',
              '- `client.ts:42`: retry on 429 using `Retry-After`.',
              '- `client.ts:88`: include the request id in thrown errors.',
              '- `retry.ts:17`: cap the total backoff at 30 seconds.',
              '',
              "`src/api/errors.ts` doesn't exist, so the error types live in `client.ts` for now.",
            ].join('\n'),
          },
        ],
      },
    ],
  })
}
