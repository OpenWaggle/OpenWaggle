import { seedSingleSession } from './support/session-fixtures'
import {
  ANTHROPIC_OPUS,
  CODEMODE_THREAD_TITLE,
  minutesAgo,
} from './website-screenshot-feature-fixture'

const CODEMODE_CALL_ID = 'website-codemode-1'
const CODEMODE_DURATION_MS = 412
const CODEMODE_PROMPT_MINUTES_AGO = 5
const CODEMODE_SCRIPT_MINUTES_AGO = 4
const CODEMODE_ANSWER_MINUTES_AGO = 3

const CODEMODE_SCRIPT = [
  "const files = ['src/api/client.ts', 'src/api/retry.ts', 'src/api/errors.ts']",
  'const results = await Promise.allSettled(',
  '  files.map((path) => tools.read({ path })),',
  ')',
  "const todos = await tools.grep({ pattern: 'TODO', path: 'src/api' })",
  'for (const [i, result] of results.entries()) {',
  "  if (result.status === 'rejected') console.log(files[i], result.reason)",
  '}',
  'console.log(todos)',
].join('\n')

const CODEMODE_OUTPUT = [
  'src/api/errors.ts Error: ENOENT: no such file or directory',
  'src/api/client.ts:42: // TODO: retry on 429 with Retry-After',
  'src/api/client.ts:88: // TODO: surface the request id in thrown errors',
  'src/api/retry.ts:17: // TODO: cap total backoff at 30s',
].join('\n')

const CODEMODE_CALLS = [
  { name: 'read', args: '{"path":"src/api/client.ts"}', status: 'ok', durationMs: 14 },
  { name: 'read', args: '{"path":"src/api/retry.ts"}', status: 'ok', durationMs: 11 },
  {
    name: 'read',
    args: '{"path":"src/api/errors.ts"}',
    status: 'error',
    durationMs: 3,
    error: 'ENOENT: no such file or directory',
  },
  { name: 'grep', args: '{"pattern":"TODO","path":"src/api"}', status: 'ok', durationMs: 38 },
].map((call, index) => ({ id: `${CODEMODE_CALL_ID}/${String(index + 1)}`, ...call }))

/** A transcript with one finished codemode call: four tool calls, one of them failed. */
export async function seedCodemodeSession(userDataDir: string, projectPath: string) {
  const now = Date.now()
  const codemodeResult = {
    content: [{ type: 'text', text: CODEMODE_OUTPUT }],
    details: { calls: CODEMODE_CALLS },
  }
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
              result: codemodeResult,
              isError: false,
              duration: CODEMODE_DURATION_MS,
              details: codemodeResult.details,
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
