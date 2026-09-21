import fs from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createModelRef } from '../../src/shared/types/llm'

export const COMPACTION_PROBE_MODEL = createModelRef('e2e-compaction', 'fixture')
const COMPACTION_REQUEST_NUMBER = 2
const CONTINUATION_REQUEST_NUMBER = 3
const CONTEXT_TOKENS_BEFORE_COMPACTION = 90_000
const CONTEXT_TOKENS_AFTER_COMPACTION = 100
const PROBE_CONTEXT_WINDOW = 100_000
const PROBE_MAX_TOKENS = 1_000
const HTTP_OK = 200

function completeResponse(response: ServerResponse, text: string, tokens: number) {
  const common = { id: 'e2e-completion', object: 'chat.completion.chunk', model: 'fixture' }
  response.writeHead(HTTP_OK, { 'content-type': 'text/event-stream' })
  for (const chunk of [
    { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    {
      choices: [],
      usage: { prompt_tokens: tokens, completion_tokens: 1, total_tokens: tokens + 1 },
    },
  ]) {
    response.write(`data: ${JSON.stringify({ ...common, ...chunk })}\n\n`)
  }
  response.end('data: [DONE]\n\n')
}

/** Only the model transport is controlled; Pi and durable Session Host commands remain real. */
export async function createCompactionProviderProbe(piAgentDir: string, projectPath: string) {
  const requests: string[] = []
  let compactionResponse: ServerResponse | undefined
  let continuationResponse: ServerResponse | undefined
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push(Buffer.concat(chunks).toString('utf8'))
      if (requests.length === COMPACTION_REQUEST_NUMBER) {
        compactionResponse = response
        return
      }
      // Keep the Run streaming after compaction so Pi can acknowledge steering without
      // delivering its queued user message until the test explicitly releases this response.
      if (requests.length === CONTINUATION_REQUEST_NUMBER) {
        continuationResponse = response
        return
      }
      completeResponse(
        response,
        requests.length === 1
          ? 'Reached the context threshold.'
          : 'Continued with the requested direction.',
        requests.length === 1 ? CONTEXT_TOKENS_BEFORE_COMPACTION : CONTEXT_TOKENS_AFTER_COMPACTION,
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a loopback provider port.')
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  try {
    await fs.mkdir(piAgentDir, { recursive: true })
    await fs.writeFile(
      path.join(piAgentDir, 'models.json'),
      JSON.stringify({
        providers: {
          'e2e-compaction': {
            baseUrl,
            api: 'openai-completions',
            apiKey: 'e2e-local-only',
            models: [
              {
                id: 'fixture',
                name: 'E2E Compaction',
                reasoning: false,
                input: ['text'],
                contextWindow: PROBE_CONTEXT_WINDOW,
                maxTokens: PROBE_MAX_TOKENS,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      }),
    )
    const settingsDirectory = path.join(projectPath, '.openwaggle')
    await fs.mkdir(settingsDirectory, { recursive: true })
    await fs.writeFile(
      path.join(settingsDirectory, 'settings.json'),
      JSON.stringify({
        pi: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: PROBE_MAX_TOKENS } },
      }),
    )
  } catch (error) {
    server.closeAllConnections()
    server.close()
    throw error
  }
  return {
    baseUrl,
    requests,
    compactionPending: () => compactionResponse !== undefined,
    continuationPending: () => continuationResponse !== undefined,
    releaseCompaction() {
      if (!compactionResponse) throw new Error('Pi has not requested compaction yet.')
      completeResponse(
        compactionResponse,
        'Kept the active task context.',
        CONTEXT_TOKENS_AFTER_COMPACTION,
      )
      compactionResponse = undefined
    },
    releaseContinuation() {
      if (!continuationResponse) throw new Error('Pi has not requested continuation yet.')
      completeResponse(
        continuationResponse,
        'Resumed the original request after compaction.',
        CONTEXT_TOKENS_AFTER_COMPACTION,
      )
      continuationResponse = undefined
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
