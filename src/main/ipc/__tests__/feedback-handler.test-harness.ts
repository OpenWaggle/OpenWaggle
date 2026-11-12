/** The feedback IPC handlers over a scripted `child_process` and real log files. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { FeedbackPayload } from '@shared/types/feedback'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void
interface ProcessReply {
  readonly stdout?: string
  readonly stderr?: string
  readonly fails?: boolean
}

interface FeedbackHarness {
  handlers: Map<string, (...args: unknown[]) => unknown>
  logPath: string
  /** What each spawned command answers, keyed by `command args…`; unknown commands fail. */
  replies: Map<string, ProcessReply>
  spawned: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[]
}

const hoistedHarness = vi.hoisted((): FeedbackHarness => ({
  handlers: new Map(),
  logPath: '',
  replies: new Map(),
  spawned: [],
}))
export const harness: FeedbackHarness = hoistedHarness

vi.mock('node:child_process', () => ({
  execFile: (
    command: string,
    args: readonly string[],
    options: { env?: NodeJS.ProcessEnv },
    callback: ExecCallback,
  ) => {
    hoistedHarness.spawned.push({ command, args, env: options.env })
    const reply = hoistedHarness.replies.get([command, ...args].join(' '))
    if (!reply || reply.fails) {
      callback(new Error(`${command} failed`), '', reply?.stderr ?? '')
      return
    }
    callback(null, reply.stdout ?? '', reply.stderr ?? '')
  },
}))
vi.mock('../../runtime', () => ({
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromiseExit(effect),
}))
vi.mock('../../gui-runtime', () => ({
  runGuiEffectExit: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromiseExit(effect),
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0-test' },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      hoistedHarness.handlers.set(channel, handler)
    },
    on: () => undefined,
  },
}))
vi.mock('../../logger', async (importActual) => ({
  ...(await importActual<typeof import('../../logger')>()),
  getLogFilePath: () => hoistedHarness.logPath,
}))

const { registerFeedbackHandlers } = await import('../feedback-handler')

export const NO_SECTIONS: FeedbackPayload = {
  title: 'Bug',
  description: 'Something broke',
  category: 'bug',
  includeSystemInfo: false,
  includeLogs: false,
  includeErrorContext: false,
  includeLastMessage: false,
  includeModelInfo: false,
}

export function invoke(channel: string, ...args: unknown[]) {
  const handler = hoistedHarness.handlers.get(channel)
  if (!handler) throw new Error(`${channel} is not registered`)
  return Promise.resolve(handler({}, ...args))
}

export function markdown(overrides: Partial<FeedbackPayload>) {
  return invoke('feedback:generate-markdown', { ...NO_SECTIONS, ...overrides })
}

let logDirectory = ''

beforeAll(async () => {
  logDirectory = await mkdtemp(path.join(os.tmpdir(), 'feedback-logs-'))
})

afterAll(async () => {
  await rm(logDirectory, { recursive: true, force: true })
})

beforeEach(() => {
  hoistedHarness.handlers.clear()
  hoistedHarness.replies.clear()
  hoistedHarness.spawned.length = 0
  hoistedHarness.logPath = ''
  registerFeedbackHandlers()
})

/** Writes the GUI log under `name`, and the Session Host log beside it when `host` is given. */
export async function writeLogs(gui: string, host?: string, name = 'openwaggle-2026-11-11.log') {
  await mkdir(logDirectory, { recursive: true })
  hoistedHarness.logPath = path.join(logDirectory, name)
  await writeFile(hoistedHarness.logPath, gui)
  const hostPath = path.join(logDirectory, 'openwaggle-host-2026-11-11.log')
  if (host === undefined) await rm(hostPath, { force: true })
  else await writeFile(hostPath, host)
}
