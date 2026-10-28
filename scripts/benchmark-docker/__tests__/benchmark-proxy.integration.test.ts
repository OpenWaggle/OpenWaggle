import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { asarImage } from '../../__tests__/asar-fixtures'
import { readAppIdentity } from '../app-identity'
import { firstRequestOf, requestTokens } from '../request-tokens'

/**
 * The first-turn token benchmark's credential-injecting proxy and container script (MEMORY
 * "Active Warnings"): the proxy relays the upstream response exactly once with its real status,
 * swaps in the real key, logs the request and usage, and listens on loopback only. Every local
 * container can reach it anyway, so it forwards only requests carrying the run token, for the
 * benchmark's endpoints and model, and keeps the real key off its argv.
 */
const PROXY = path.join(import.meta.dirname, '..', 'proxy.py')
const PARSE_RESULTS = path.join(import.meta.dirname, '..', 'parse-results.py')
const SLOW_FIRST_RESPONSE_MS = 200
const ARRIVAL_GAP_MS = 50
const FIRST_CALL_PROMPT_TOKENS = 4175
const TITLE_CALL_PROMPT_TOKENS = 515
const INSIDE = path.join(import.meta.dirname, '..', 'inside.sh')
const RUN = path.join(import.meta.dirname, '..', 'run.sh')
const REAL_KEY = 'sk-or-real-key'
const RUN_TOKEN = 'per-run-token'
const MODEL = 'z-ai/glm-5.3-flash'
const HTTP_FORBIDDEN = 403
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

/** `respond` lets a test shape each response; by default every request gets `SSE_BODY` at once. */
async function startUpstream(respond: (index: number) => Promise<string> = async () => SSE_BODY) {
  const seen: IncomingHttpHeaders[] = []
  const paths: string[] = []
  const server: Server = createServer((request, response) => {
    const index = seen.length
    seen.push(request.headers)
    paths.push(request.url ?? '')
    request.resume()
    request.on('end', () => {
      void respond(index).then((body) => {
        response.writeHead(UPSTREAM_STATUS, { 'content-type': 'text/event-stream' })
        response.end(body)
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  return { url: `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`, seen, paths }
}

async function startProxy(upstream: string, logPath: string) {
  const port = await freePort()
  const child: ChildProcess = spawn('python3', [PROXY, String(port), logPath], {
    env: {
      ...process.env,
      BENCH_PROXY_UPSTREAM: upstream,
      OPENROUTER_API_KEY: REAL_KEY,
      BENCH_PROXY_TOKEN: RUN_TOKEN,
      BENCH_MODEL: MODEL,
    },
    stdio: 'ignore',
  })
  cleanups.push(() => {
    child.kill()
  })
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ready = await fetch(`http://127.0.0.1:${String(port)}/__bench/ready`).then((response) => response.ok, () => false)
    if (ready) return { port, pid: child.pid ?? 0 }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
  }
  throw new Error('The proxy did not start.')
}

function chatRequest(headers: Record<string, string>, model = MODEL) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages: [] }),
  }
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
    const { port } = await startProxy(upstream.url, logPath)

    const response = await fetch(`http://127.0.0.1:${String(port)}/api/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${RUN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: 'Be brief.' }] }),
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

  it('records the agent named in the base URL and forwards the rest of the path', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-proxy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const logPath = path.join(directory, 'proxy-log.jsonl')
    const upstream = await startUpstream()
    const { port } = await startProxy(upstream.url, logPath)

    await fetch(
      `http://127.0.0.1:${String(port)}/agent/opencode/api/v1/chat/completions`,
      chatRequest({ authorization: `Bearer ${RUN_TOKEN}` }),
    ).then((response) => response.text())

    expect(upstream.paths.at(-1)).toBe('/api/v1/chat/completions')
    const records = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(records.find((record) => record.command === 'POST')).toMatchObject({ agent: 'opencode', path: '/api/v1/chat/completions' })
  })

  it.skipIf(!nonLoopbackAddress())('does not listen on other interfaces', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-proxy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const upstream = await startUpstream()
    const { port } = await startProxy(upstream.url, path.join(directory, 'proxy-log.jsonl'))
    const reachable = await fetch(`http://${nonLoopbackAddress() ?? ''}:${String(port)}/__bench/ready`).then(() => true, () => false)
    expect(reachable).toBe(false)
  })

  it('refuses requests without the run token, and the upstream never sees them', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-proxy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const upstream = await startUpstream()
    const { port } = await startProxy(upstream.url, path.join(directory, 'proxy-log.jsonl'))
    const url = `http://127.0.0.1:${String(port)}/api/v1/chat/completions`

    const missing = await fetch(url, chatRequest({}))
    const wrongBearer = await fetch(url, chatRequest({ authorization: 'Bearer bench-proxy' }))
    const wrongApiKey = await fetch(url, chatRequest({ 'x-api-key': 'bench-proxy' }))
    const apiKey = await fetch(url, chatRequest({ 'x-api-key': RUN_TOKEN }))
    await apiKey.text()

    expect([missing.status, wrongBearer.status, wrongApiKey.status]).toEqual([HTTP_FORBIDDEN, HTTP_FORBIDDEN, HTTP_FORBIDDEN])
    expect(apiKey.status).toBe(UPSTREAM_STATUS)
    expect(upstream.paths).toEqual(['/api/v1/chat/completions'])
  })

  it('forwards only the benchmark endpoints and model', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-proxy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const upstream = await startUpstream()
    const { port } = await startProxy(upstream.url, path.join(directory, 'proxy-log.jsonl'))
    const base = `http://127.0.0.1:${String(port)}`
    const authorization = { authorization: `Bearer ${RUN_TOKEN}` }

    const key = await fetch(`${base}/api/v1/key`, { headers: authorization })
    const credits = await fetch(`${base}/agent/pi/api/v1/credits`, { headers: authorization })
    const otherModel = await fetch(`${base}/api/v1/chat/completions`, chatRequest(authorization, 'anthropic/claude-opus-4'))
    const messages = await fetch(`${base}/agent/claude/api/v1/messages?beta=true`, chatRequest(authorization))
    await messages.text()

    expect([key.status, credits.status, otherModel.status]).toEqual([HTTP_FORBIDDEN, HTTP_FORBIDDEN, HTTP_FORBIDDEN])
    expect(messages.status).toBe(UPSTREAM_STATUS)
    expect(upstream.paths).toEqual(['/api/v1/messages?beta=true'])
  })

  it('keeps the real key off its command line', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-proxy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const upstream = await startUpstream()
    const { pid } = await startProxy(upstream.url, path.join(directory, 'proxy-log.jsonl'))
    const argv = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' })
    expect(argv).toContain('proxy.py')
    expect(argv).not.toContain(REAL_KEY)
  })

  it('records arrival order, so the first request wins even when a later one finishes first', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-proxy-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const logPath = path.join(directory, 'proxy-log.jsonl')
    const usageBody = (promptTokens: number) => `data: {"usage":{"prompt_tokens":${String(promptTokens)},"completion_tokens":1}}\n\ndata: [DONE]\n\n`
    // The first model call streams for a while; the title call sent after it returns at once.
    const upstream = await startUpstream(async (index) => {
      if (index > 0) return usageBody(TITLE_CALL_PROMPT_TOKENS)
      await new Promise((resolve) => setTimeout(resolve, SLOW_FIRST_RESPONSE_MS))
      return usageBody(FIRST_CALL_PROMPT_TOKENS)
    })
    const { port } = await startProxy(upstream.url, logPath)
    const url = `http://127.0.0.1:${String(port)}/agent/openwaggle/api/v1/chat/completions`
    const send = (content: string) =>
      fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${RUN_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content }] }),
      }).then((response) => response.text())
    const first = send('first model call')
    await new Promise((resolve) => setTimeout(resolve, ARRIVAL_GAP_MS))
    await Promise.all([first, send('title call')])

    const lines = (await readFile(logPath, 'utf8')).trim().split('\n')
    // The log is in completion order: the title call is written first.
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ seq: 2, request: { messages: [{ content: 'title call' }] } })
    expect(firstRequestOf(lines)).toMatchObject({ messages: [{ content: 'first model call' }] })
    await writeFile(path.join(directory, 'openwaggle.proxy.jsonl'), `${lines.join('\n')}\n`)
    execFileSync('python3', [PARSE_RESULTS, directory], { stdio: 'ignore' })
    const results = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'))
    expect(results.agents.openwaggle).toMatchObject({ turnOneTokens: FIRST_CALL_PROMPT_TOKENS, modelCalls: 2 })
  })

  it('refuses to start without the real key, the run token or the model', () => {
    for (const missing of ['OPENROUTER_API_KEY', 'BENCH_PROXY_TOKEN', 'BENCH_MODEL']) {
      const environment: Record<string, string | undefined> = {
        ...process.env,
        OPENROUTER_API_KEY: REAL_KEY,
        BENCH_PROXY_TOKEN: RUN_TOKEN,
        BENCH_MODEL: MODEL,
      }
      delete environment[missing]
      expect(() => execFileSync('python3', [PROXY, '0', '/dev/null'], { env: environment, stdio: 'pipe' })).toThrow()
    }
  })
})

describe('benchmark container scripts', () => {
  it('parse as shell, and the DeepSeek harness probe imports what it uses', () => {
    execFileSync('bash', ['-n', INSIDE])
    execFileSync('bash', ['-n', RUN])
  })

  it('give the agents the per-run token and never a fixed dummy key', async () => {
    const inside = await readFile(INSIDE, 'utf8')
    const run = await readFile(RUN, 'utf8')
    expect(inside).not.toContain('bench-proxy')
    expect(inside).toContain('BENCH_PROXY_TOKEN')
    expect(run).toContain('-e BENCH_PROXY_TOKEN')
    // The key reaches the proxy through its environment and leaves run.sh's afterwards.
    expect(run).not.toMatch(/proxy\.py"[^\n]*\$OPENROUTER_API_KEY/)
    expect(run).toMatch(/^unset OPENROUTER_API_KEY$/m)
  })

  it('declares every Python module the DeepSeek harness probe uses', async () => {
    const inside = await readFile(INSIDE, 'utf8')
    const probe = inside.slice(inside.indexOf("<<'PYEOF'") + "<<'PYEOF'".length, inside.indexOf('PYEOF\n', inside.indexOf("<<'PYEOF'") + 1))
    expect(probe).toContain('os.environ')
    expect(probe).toMatch(/^import os$/m)
  })
})

describe('benchmark OpenWaggle build identity', () => {
  const COMMIT = 'f2e7d1fa5c0ffee'
  const VERSION = '1.0.0-beta.27'

  it('reads the version and build commit of a packaged app and of a built checkout', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-identity-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const bundle = path.join(directory, 'OpenWaggle.app')
    await mkdir(path.join(bundle, 'Contents', 'Resources'), { recursive: true })
    await writeFile(
      path.join(bundle, 'Contents', 'Resources', 'app.asar'),
      asarImage({ 'package.json': JSON.stringify({ version: VERSION }), 'out/build-meta.json': JSON.stringify({ commit: COMMIT }) }),
    )
    const checkout = path.join(directory, 'checkout')
    await mkdir(path.join(checkout, 'out'), { recursive: true })
    await writeFile(path.join(checkout, 'package.json'), JSON.stringify({ version: VERSION }))

    expect(await readAppIdentity(bundle)).toEqual({ appVersion: VERSION, commit: COMMIT })
    expect(await readAppIdentity(checkout)).toEqual({ appVersion: VERSION, commit: null })
  })

  it('lands in the OpenWaggle entry of results.json', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bench-identity-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    await writeFile(path.join(directory, 'openwaggle.proxy.jsonl'), '')
    await writeFile(path.join(directory, 'openwaggle.app.json'), JSON.stringify({ appVersion: VERSION, commit: COMMIT }))
    execFileSync('python3', [PARSE_RESULTS, directory], { stdio: 'ignore' })
    const results = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'))
    expect(results.agents.openwaggle).toMatchObject({ appVersion: VERSION, commit: COMMIT })
  })

  it('points the OpenWaggle row at the address the proxy listens on, and only on macOS', async () => {
    const run = await readFile(RUN, 'utf8')
    expect(run).toContain('--proxy "http://$BENCH_PROXY_BIND:$PROXY_PORT/agent/openwaggle"')
    expect(run).toContain('curl -s -o /dev/null "http://$BENCH_PROXY_BIND:$PROXY_PORT/__bench/ready"')
    expect(run).toContain('runs on macOS only')
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
