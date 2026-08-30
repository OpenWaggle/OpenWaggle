import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const APP_NAME = 'OpenWaggle.app'
const FIRST_USER_ARGUMENT_INDEX = 2
const STARTUP_TIMEOUT_MS = 30_000
const RETRY_DELAY_MS = 250
const STOP_TIMEOUT_MS = 3_000
const MAX_LOG_BYTES = 64_000
const LIST_LIMIT = 20

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message)
  }
}

async function pathExists(candidate: string) {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}

export async function findPackagedExecutable() {
  const explicit = process.argv[FIRST_USER_ARGUMENT_INDEX]
  if (explicit) {
    const resolved = path.resolve(explicit)
    return resolved.endsWith('.app')
      ? path.join(resolved, 'Contents', 'MacOS', 'OpenWaggle')
      : resolved
  }
  const candidates = (await fs.readdir('dist', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.resolve('dist', entry.name, APP_NAME, 'Contents', 'MacOS', 'OpenWaggle'))
  const existing: string[] = []
  for (const candidate of candidates) {
    if (await pathExists(candidate)) existing.push(candidate)
  }
  if (existing.length !== 1) {
    throw new Error(`Expected one packaged OpenWaggle executable, found ${existing.length}.`)
  }
  return existing[0] ?? ''
}

export function childEnvironment(userDataRoot: string) {
  return Object.fromEntries(
    Object.entries({
      ...process.env,
      OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
      OPENWAGGLE_USER_DATA_DIR: userDataRoot,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_RUN_AS_NODE: undefined,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function appendBoundedLog(current: string, chunk: unknown) {
  const next = `${current}${String(chunk)}`
  return next.length <= MAX_LOG_BYTES ? next : next.slice(-MAX_LOG_BYTES)
}

export function launchGui(executable: string, env: Record<string, string>) {
  const child = spawn(executable, [], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout?.on('data', (chunk) => {
    logs = appendBoundedLog(logs, chunk)
  })
  child.stderr?.on('data', (chunk) => {
    logs = appendBoundedLog(logs, chunk)
  })
  return { child, logs: () => logs }
}

export async function runProcess(
  command: string,
  args: readonly string[],
  env: Record<string, string>,
) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve({ stdout, stderr })
      reject(
        new Error(
          `${path.basename(command)} ${args.join(' ')} failed (${code ?? signal}): ${stderr || stdout}`,
        ),
      )
    })
  })
}

export async function runJsonCli(
  executable: string,
  env: Record<string, string>,
  args: readonly string[],
) {
  const result = await runProcess(executable, [...args, '--json'], env)
  const parsed: unknown = JSON.parse(result.stdout)
  assertRecord(parsed, 'CLI response was not an object.')
  if (parsed.type === 'error') throw new Error(`CLI error: ${result.stdout}`)
  return parsed
}

export function cliOutcome(response: Record<string, unknown>) {
  const result = response.result
  assertRecord(result, 'CLI response omitted result.')
  const contractResponse = result.response
  assertRecord(contractResponse, 'CLI response omitted contract response.')
  const outcome = contractResponse.outcome
  assertRecord(outcome, 'CLI response omitted outcome.')
  return outcome
}

export async function waitForHost(executable: string, env: Record<string, string>) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await runJsonCli(executable, env, ['sessions', 'list', '--all', '--limit', '1'])
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
  throw new Error(`Session Host did not become ready: ${String(lastError)}`)
}

export async function waitForIdle(
  executable: string,
  env: Record<string, string>,
  sessionId: string,
  timeoutMs: number,
) {
  const response = await runJsonCli(executable, env, [
    'sessions',
    'wait',
    sessionId,
    '--condition',
    'idle',
    '--timeout-ms',
    String(timeoutMs),
  ])
  if (cliOutcome(response).timedOut === true) {
    throw new Error(`Timed out waiting for Session ${sessionId}.`)
  }
}

export async function readTranscript(
  executable: string,
  env: Record<string, string>,
  sessionId: string,
) {
  const { stdout } = await runProcess(
    executable,
    ['sessions', 'read', sessionId, '--full', '--jsonl'],
    env,
  )
  return stdout
}

export function findWorker(listResponse: Record<string, unknown>, queenSessionId: string) {
  const sessions = cliOutcome(listResponse).sessions
  if (!Array.isArray(sessions)) throw new Error('Session list omitted sessions.')
  const sessionRecords: unknown[] = sessions
  const workers = sessionRecords.filter(
    (session) =>
      typeof session === 'object' &&
      session !== null &&
      'parentSessionId' in session &&
      session.parentSessionId === queenSessionId,
  )
  if (workers.length !== 1) throw new Error(`Expected one Worker, found ${workers.length}.`)
  const worker: unknown = workers[0]
  assertRecord(worker, 'Worker summary was invalid.')
  if (typeof worker.sessionId !== 'string') throw new Error('Worker summary omitted Session ID.')
  return worker.sessionId
}

async function callSessionTool(
  client: Client,
  args: Record<string, unknown>,
  timeoutMs: number,
) {
  const result = await client.callTool(
    { name: 'openwaggle_sessions', arguments: args },
    { timeout: timeoutMs, maxTotalTimeout: timeoutMs },
  )
  if (result.isError === true) throw new Error(`MCP tool failed: ${JSON.stringify(result.content)}`)
  return result
}

export async function verifyExternalMcp(input: {
  readonly executable: string
  readonly env: Record<string, string>
  readonly projectPath: string
  readonly queenSessionId: string
  readonly workerSessionId: string
  readonly timeoutMs: number
}) {
  const transport = new StdioClientTransport({
    command: input.executable,
    args: [
      'mcp',
      'serve',
      '--stdio',
      '--profile',
      'live-orchestration-qa',
      '--grant',
      'sessions:discover',
      '--grant',
      'sessions:read',
      '--grant',
      'sessions:message',
      '--workspace',
      input.projectPath,
    ],
    env: input.env,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'OpenWaggle live QA', version: '1.0.0' })
  try {
    await client.connect(transport, { timeout: STARTUP_TIMEOUT_MS })
    const tools = await client.listTools()
    if (!tools.tools.some((tool) => tool.name === 'openwaggle_sessions')) {
      throw new Error('MCP server did not advertise openwaggle_sessions.')
    }
    const list = await callSessionTool(
      client,
      { operation: 'list', catalogScope: 'all', limit: LIST_LIMIT },
      input.timeoutMs,
    )
    const catalog = JSON.stringify(list.structuredContent)
    if (!catalog.includes(input.queenSessionId) || !catalog.includes(input.workerSessionId)) {
      throw new Error('MCP discovery did not expose the live Hive Sessions.')
    }
    await callSessionTool(
      client,
      {
        operation: 'message',
        sessionId: input.workerSessionId,
        message: 'Reply with exactly EXTERNAL-MCP-OK and do not use tools.',
      },
      input.timeoutMs,
    )
    await callSessionTool(
      client,
      {
        operation: 'wait',
        sessionIds: [input.workerSessionId],
        condition: 'idle',
        timeoutMs: input.timeoutMs,
      },
      input.timeoutMs,
    )
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}
