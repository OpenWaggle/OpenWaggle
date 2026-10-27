import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { requestTokens } from '../request-tokens'

/**
 * The first-turn token benchmark's credential-injecting proxy and container script (MEMORY
 * "Active Warnings"): the proxy relays the upstream response exactly once with its real status,
 * swaps in the real key, logs the request and usage, and listens on loopback only.
 */
const PROXY = path.join(import.meta.dirname, '..', 'proxy.py')
const INSIDE = path.join(import.meta.dirname, '..', 'inside.sh')
const RUN = path.join(import.meta.dirname, '..', 'run.sh')
const REAL_KEY = 'sk-or-real-key'
const SSE_BODY = 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: {"usage":{"prompt_tokens":1234,"completion_tokens":2}}\n\ndata: [DONE]\n\n'
const UPSTREAM_STATUS = 201
const READY_POLL_MS = 50
const READY_TIMEOUT_MS = 10_000

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

function freePort() {
  return new Promise<number>((resolve) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function startUpstream() {
  const seen: IncomingHttpHeaders[] = []
  const server: Server = createServer((request, response) => {
    seen.push(request.headers)
    request.resume()
    request.on('end', () => {
      response.writeHead(UPSTREAM_STATUS, { 'content-type': 'text/event-stream' })
      response.end(SSE_BODY)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  return { url: `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`, seen }
}

async function startProxy(upstream: string, logPath: string) {
  const port = await freePort()
  const child: ChildProcess = spawn('python3', [PROXY, String(port), REAL_KEY, logPath], {
    env: { ...process.env, BENCH_PROXY_UPSTREAM: upstream },
    stdio: 'ignore',
  })
  cleanups.push(() => {
    child.kill()
  })
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ready = await fetch(`http://127.0.0.1:${String(port)}/ready`).then(() => true, () => false)
    if (ready) return port
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
  }
  throw new Error('The proxy did not start.')
}

function nonLoopbackAddress() {
  return Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address
}

describe('benchmark proxy', () => {
  it('relays the upstream response once, with its status, the real key and a usage log', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-proxy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const logPath = path.join(directory, 'proxy-log.jsonl')
    const upstream = await startUpstream()
    const port = await startProxy(upstream.url, logPath)

    const response = await fetch(`http://127.0.0.1:${String(port)}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer bench-proxy', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'z-ai/glm-5.3-flash', messages: [{ role: 'system', content: 'Be brief.' }] }),
    })
    const body = await response.text()

    expect(response.status).toBe(UPSTREAM_STATUS)
    expect(body).toBe(SSE_BODY)
    expect(upstream.seen.at(-1)?.authorization).toBe(`Bearer ${REAL_KEY}`)
    const records = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    const post = records.find((record) => record.command === 'POST')
    expect(post).toMatchObject({ status: UPSTREAM_STATUS, model: 'z-ai/glm-5.3-flash', request: { messages: [{ role: 'system' }] } })
    expect(post.usage_events).toContainEqual({ prompt_tokens: 1234, completion_tokens: 2 })
    expect(JSON.stringify(records)).not.toContain(REAL_KEY)
  })

  it.skipIf(!nonLoopbackAddress())('does not listen on other interfaces', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-proxy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const upstream = await startUpstream()
    const port = await startProxy(upstream.url, path.join(directory, 'proxy-log.jsonl'))
    const reachable = await fetch(`http://${nonLoopbackAddress() ?? ''}:${String(port)}/ready`).then(() => true, () => false)
    expect(reachable).toBe(false)
  })
})

describe('benchmark container scripts', () => {
  it('parse as shell, and the DeepSeek harness probe imports what it uses', () => {
    execFileSync('bash', ['-n', INSIDE])
    execFileSync('bash', ['-n', RUN])
  })

  it('declares every Python module the DeepSeek harness probe uses', async () => {
    const inside = await readFile(INSIDE, 'utf8')
    const probe = inside.slice(inside.indexOf("<<'PYEOF'") + "<<'PYEOF'".length, inside.indexOf('PYEOF\n', inside.indexOf("<<'PYEOF'") + 1))
    expect(probe).toContain('os.environ')
    expect(probe).toMatch(/^import os$/m)
  })
})

describe('benchmark request tokens', () => {
  it('counts the system prompt and tools of chat, responses and messages requests', () => {
    const tool = { type: 'function', function: { name: 'bash', description: 'Run a shell command.', parameters: { type: 'object' } } }
    const chat = requestTokens({ messages: [{ role: 'system', content: 'You are a coding agent.' }, { role: 'user', content: 'hi' }], tools: [tool] })
    const responses = requestTokens({ instructions: 'You are a coding agent.', input: [{ role: 'user', content: 'hi' }], tools: [tool] })
    const messages = requestTokens({ system: [{ type: 'text', text: 'You are a coding agent.' }], tools: [tool] })
    expect(chat.toolCount).toBe(1)
    expect(chat.systemO200k).toBeGreaterThan(0)
    expect(responses.systemO200k).toBe(chat.systemO200k)
    expect(messages.systemO200k).toBe(chat.systemO200k)
    expect(chat.prefixO200k).toBe(chat.systemO200k + chat.toolsO200k)
  })
})
