import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createPiRuntimeServices } from '../../../../src/main/adapters/pi/pi-provider-catalog'
import { measurementEnvironment } from '../../lib/perf-results'
import { summarize } from '../../lib/perf-stats'

/**
 * "Bedrock time to first byte per call" (v1 performance plan): sequential small requests through
 * OpenWaggle's own Pi runtime (the bundled Bedrock provider and its credential handling), each
 * timed from the request until its first streamed event and its first text. Only runs with
 *
 *   OPENWAGGLE_PERF_BEDROCK_MODEL=eu.anthropic.claude-sonnet-5 AWS_PROFILE=<sso profile> \
 *     OPENWAGGLE_PERF_OUT=<dir> pnpm perf:bedrock-ttfb
 *
 * The test home has no AWS configuration, so the user's `~/.aws` is linked into it (read as the
 * AWS CLI reads it; a refreshed SSO token is written back there as the CLI would).
 */
const modelId = process.env.OPENWAGGLE_PERF_BEDROCK_MODEL
const outDirectory = process.env.OPENWAGGLE_PERF_OUT
const CALLS = Number(process.env.OPENWAGGLE_PERF_BEDROCK_CALLS ?? '20')
const MAX_TOKENS = 64
const TIMEOUT_MS = 300_000
const JSON_INDENT = 2

vi.mock('electron', () => ({
  app: { getPath: () => process.env.OPENWAGGLE_USER_DATA_DIR ?? os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: {},
}))

/**
 * Every TLS connection the process opens, with its host and handshake time: per-request client
 * construction shows up as one or more new handshakes (Bedrock, SSO) on every call.
 */
interface Handshake {
  readonly host: string
  readonly startedAt: number
  ms: number | null
}
const handshakes: Handshake[] = []
const originalConnect = tls.connect
vi.spyOn(tls, 'connect').mockImplementation((...args: Parameters<typeof tls.connect>) => {
  const socket = Reflect.apply(originalConnect, tls, args)
  const options: unknown = args[0]
  const host = typeof options === 'object' && options !== null ? String(Reflect.get(options, 'servername') ?? Reflect.get(options, 'host') ?? '') : String(options)
  const record: Handshake = { host, startedAt: performance.now(), ms: null }
  handshakes.push(record)
  socket.once('secureConnect', () => {
    record.ms = performance.now() - record.startedAt
  })
  return socket
})

const cleanups: string[] = []
afterAll(async () => {
  await Promise.all(cleanups.map((directory) => rm(directory, { recursive: true, force: true })))
})

async function linkUserAwsConfiguration() {
  const home = process.env.HOME ?? os.homedir()
  await symlink(path.join(os.userInfo().homedir, '.aws'), path.join(home, '.aws')).catch(() => undefined)
}

describe.skipIf(!modelId)('Bedrock time to first byte', () => {
  it(
    'times sequential requests through the OpenWaggle Pi runtime',
    async () => {
      await linkUserAwsConfiguration()
      const project = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-bedrock-ttfb-'))
      cleanups.push(project)
      const services = await createPiRuntimeServices(project)
      const model = services.modelRuntime.getModel('amazon-bedrock', modelId ?? '')
      if (!model) throw new Error(`Pi does not know amazon-bedrock/${modelId ?? ''}.`)
      const calls = []
      for (let index = 0; index < CALLS; index += 1) {
        const startedAt = performance.now()
        const handshakesBefore = handshakes.length
        let firstEventMs: number | null = null
        let firstTextMs: number | null = null
        const stream = services.modelRuntime.streamSimple(
          model,
          {
            systemPrompt: 'Answer with one word.',
            messages: [{ role: 'user', content: `Say OK (${String(index)}).`, timestamp: Date.now() }],
          },
          { maxTokens: MAX_TOKENS, reasoning: 'minimal' },
        )
        for await (const event of stream) {
          firstEventMs ??= performance.now() - startedAt
          if (event.type === 'text_delta') firstTextMs ??= performance.now() - startedAt
          if (event.type === 'error') throw new Error(event.error.errorMessage ?? 'Bedrock request failed.')
        }
        const opened = handshakes.slice(handshakesBefore)
        calls.push({
          index,
          firstEventMs,
          firstTextMs,
          totalMs: performance.now() - startedAt,
          tlsHandshakes: opened.length,
          tlsHandshakeMs: opened.reduce((total, handshake) => total + (handshake.ms ?? 0), 0),
          tlsHosts: opened.map((handshake) => handshake.host),
        })
      }
      const later = calls.slice(1)
      const report = {
        kind: 'bedrock-ttfb',
        environment: measurementEnvironment(),
        model: `amazon-bedrock/${modelId ?? ''}`,
        firstCall: calls[0],
        laterCalls: {
          firstEventMs: summarize(later.map((call) => call.firstEventMs)),
          firstTextMs: summarize(later.map((call) => call.firstTextMs)),
          totalMs: summarize(later.map((call) => call.totalMs)),
          tlsHandshakes: summarize(later.map((call) => call.tlsHandshakes)),
          tlsHandshakeMs: summarize(later.map((call) => call.tlsHandshakeMs)),
        },
        calls,
      }
      if (outDirectory) {
        await mkdir(outDirectory, { recursive: true })
        await writeFile(path.join(outDirectory, 'bedrock-ttfb.json'), `${JSON.stringify(report, null, JSON_INDENT)}\n`)
      }
      expect(calls).toHaveLength(CALLS)
    },
    TIMEOUT_MS,
  )
})
