import fs from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { SupportedModelId } from '@shared/types/brand'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPiSessionTitleGenerator,
  projectTitleModelRuntime,
} from '../pi-session-title-generator'

const NO_OPENWAGGLE_EXTENSIONS = {
  manager: { listPackages: () => Effect.succeed([]) },
  lifecycleRepository: {
    get: () => Effect.succeed(null),
    list: () => Effect.succeed([]),
    upsert: () => Effect.void,
  },
  projectOverridesRepository: { get: () => Effect.succeed(null), upsert: () => Effect.void },
}

const servers: Server[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))))
})

async function bodyOf(request: IncomingMessage) {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  return body
}

/** An OpenAI-compatible backend that answers every chat completion with one title. */
async function titleBackend() {
  const requestedModels: string[] = []
  const server = createServer(async (request, response) => {
    const body: unknown = JSON.parse(await bodyOf(request))
    requestedModels.push(isRecord(body) ? String(body.model) : '')
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'echo', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write(chunk({ role: 'assistant', content: '{"title":"Routed title"}' }, null))
    response.write(chunk({}, 'stop'))
    response.end('data: [DONE]\n\n')
  })
  servers.push(server)
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address')
  const { port } = address
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requestedModels }
}

/** A project whose Pi extension registers a backend and a virtual model that routes to it. */
async function projectWithRouter(baseUrl: string) {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-title-router-'))
  const extensionPath = path.join(projectPath, '.pi', 'extensions', 'qa-router.js')
  await fs.mkdir(path.dirname(extensionPath), { recursive: true })
  await fs.writeFile(
    extensionPath,
    `export default function extension(pi) {
  pi.registerProvider('qa-backend', {
    baseUrl: ${JSON.stringify(baseUrl)},
    apiKey: 'qa-backend-key',
    api: 'openai-completions',
    models: [{ id: 'echo', name: 'Echo', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8000, maxTokens: 400 }],
  })
  pi.registerVirtualModel({
    provider: 'qarouter',
    id: 'auto',
    name: 'QA Auto Router',
    route(_request, ctx) {
      return { model: ctx.modelRegistry.find('qa-backend', 'echo'), thinkingLevel: 'off' }
    },
  })
}
`,
    'utf8',
  )
  return projectPath
}

describe('a virtual model as the Title model', () => {
  it('routes the title request through the project runtime to its physical model', async () => {
    vi.stubEnv('PI_CODING_AGENT_DIR', await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-agent-')))
    const backend = await titleBackend()
    const projectPath = await projectWithRouter(backend.baseUrl)
    const generator = createPiSessionTitleGenerator({
      modelRuntime: projectTitleModelRuntime(NO_OPENWAGGLE_EXTENSIONS),
    })

    const response = await Effect.runPromise(
      generator.generate({
        projectPath,
        sessionModel: null,
        titleModel: SupportedModelId('qarouter/auto'),
        systemPrompt: 'Title it.',
        prompt: 'Debate the design',
      }),
    )

    expect(response).toEqual({
      text: '{"title":"Routed title"}',
      modelRef: SupportedModelId('qarouter/auto'),
    })
    expect(backend.requestedModels).toEqual(['echo'])
  })
})
