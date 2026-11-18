import type { Message } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentKernelRunInput } from '../../../../ports/agent-kernel-service'
import { runPiSession } from '../classic-run'
import { idleCacheWarming } from '../pi-idle-cache-warming'
import { compactPiSession, forkPiSession, navigatePiSessionTree } from '../session-operations'

/**
 * Each kernel operation that opens a Session's Pi file ends its warming session first. The Pi
 * runtime and session manager stand in for "opening the file": they record whether the warming
 * session was still there at that moment, then stop the operation.
 */
const opened = vi.hoisted(() => {
  const warmingWhenOpened: unknown[] = []
  return { warmingWhenOpened }
})
const OPENED = 'opened the Pi file'

vi.mock('../runtime-extension-isolation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runtime-extension-isolation')>()),
  createIsolatedPiProjectRuntime: vi.fn(async () => {
    const { idleCacheWarming: warming } = await import('../pi-idle-cache-warming')
    opened.warmingWhenOpened.push(warming.borrow('warming-session'))
    throw new Error(OPENED)
  }),
}))

vi.mock('../session-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session-manager')>()),
  createSessionManagerForSession: vi.fn(() => {
    throw new Error(OPENED)
  }),
  // A fork reads an in-memory copy of the file instead of opening it.
  createReadOnlySessionManagerForSession: vi.fn(async () => {
    throw new Error(OPENED)
  }),
  resolveSessionWorkingPath: vi.fn(() => '/repo'),
  findExistingPiSessionFile: vi.fn(() => '/repo/.pi/session.jsonl'),
}))

const SESSION_ID = SessionId('warming-session')

const session = fromPartial<SessionDetail>({
  id: SESSION_ID,
  projectPath: '/repo',
  piSessionFile: '/repo/.pi/session.jsonl',
  messages: [],
})

function warmingPiSession() {
  return fromPartial<Parameters<typeof idleCacheWarming.settle>[1]>({
    cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
    extensionRunner: { emit: vi.fn(async () => undefined) },
    dispose: vi.fn(),
    sessionManager: { appendUsage: vi.fn() },
  })
}

const model = SupportedModelId('openai/gpt-5.5')

const operations = {
  'a Run starts': () =>
    runPiSession(
      fromPartial<AgentKernelRunInput & { readonly workingPath: string }>({
        session,
        runId: 'run-after-warming',
        payload: { text: 'Next', attachments: [] },
        model,
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        workingPath: '/repo',
      }),
    ),
  // A Session with nothing in it has nothing to compact, and Pi is not opened for it.
  'the Session is compacted': () =>
    compactPiSession({
      session: { ...session, messages: [fromPartial<Message>({ id: 'm1', role: 'user' })] },
      model,
    }),
  'the Session tree is navigated': () =>
    navigatePiSessionTree({ session, model, targetNodeId: 'node-1' }),
  'the Session is forked': () =>
    forkPiSession({ session, model, targetNodeId: 'node-1', position: 'at' }),
} satisfies Record<string, () => Promise<unknown>>

beforeEach(() => {
  opened.warmingWhenOpened.splice(0)
})

describe('a warming session and the next operation on its Session', () => {
  it.each(Object.entries(operations))(
    'is ended before the Pi file is opened when %s',
    async (_name, operation) => {
      const warming = warmingPiSession()
      await idleCacheWarming.settle(SESSION_ID, warming, { aborted: false })

      await expect(operation()).rejects.toThrow(OPENED)

      expect(opened.warmingWhenOpened.every((value) => value === undefined)).toBe(true)
      expect(idleCacheWarming.borrow(SESSION_ID)).toBeUndefined()
      expect(warming.dispose).toHaveBeenCalledOnce()
    },
  )
})
