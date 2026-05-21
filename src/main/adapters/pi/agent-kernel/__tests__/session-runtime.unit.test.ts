import { SessionId, SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPiSession, createPiSessionRuntime, withPiSession } from '../session-runtime'

interface RuntimeFactoryOptions {
  readonly cwd: string
  readonly sessionManager: unknown
  readonly sessionStartEvent?: unknown
}

interface RuntimeOptions {
  readonly cwd: string
  readonly agentDir: string
  readonly sessionManager: unknown
}

const runtimeMocks = vi.hoisted(() => ({
  createAgentSessionRuntime: vi.fn(),
  createOpenWaggleAgentSessionFromServices: vi.fn(),
  createPiProjectModelRuntime: vi.fn(),
  createSessionManagerForSession: vi.fn(),
  disposeOpenWagglePiSession: vi.fn(),
  getPiAgentDir: vi.fn(),
  resolveSessionProjectPath: vi.fn(),
  sessionManagerCreate: vi.fn(),
}))

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSessionRuntime: runtimeMocks.createAgentSessionRuntime,
  SessionManager: { create: runtimeMocks.sessionManagerCreate },
}))

vi.mock('../../pi-provider-catalog', () => ({
  createPiProjectModelRuntime: runtimeMocks.createPiProjectModelRuntime,
  getPiAgentDir: runtimeMocks.getPiAgentDir,
}))

vi.mock('../../pi-session-lifecycle', () => ({
  createOpenWaggleAgentSessionFromServices: runtimeMocks.createOpenWaggleAgentSessionFromServices,
  disposeOpenWagglePiSession: runtimeMocks.disposeOpenWagglePiSession,
}))

vi.mock('../session-manager', () => ({
  createSessionManagerForSession: runtimeMocks.createSessionManagerForSession,
  resolveSessionProjectPath: runtimeMocks.resolveSessionProjectPath,
}))

const SESSION_ID = SessionId('session-runtime')
const MODEL = SupportedModelId('openai/gpt-5.5')
const session = { sessionId: 'pi-session-1', sessionFile: '/repo/session.jsonl' }
const model = { id: 'gpt-5.5', provider: 'openai', input: ['text'] }
const services = { diagnostics: { records: [] } }
const sessionManager = { id: 'manager-1' }

function input() {
  return {
    session: {
      id: SESSION_ID,
      title: 'Runtime session',
      projectPath: '/repo',
      piSessionId: 'pi-session-1',
      piSessionFile: '/repo/session.jsonl',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    },
    model: MODEL,
    skillToggles: { audit: true },
  }
}

describe('Pi session runtime', () => {
  beforeEach(() => {
    runtimeMocks.createAgentSessionRuntime.mockReset()
    runtimeMocks.createOpenWaggleAgentSessionFromServices.mockReset()
    runtimeMocks.createPiProjectModelRuntime.mockReset()
    runtimeMocks.createSessionManagerForSession.mockReset()
    runtimeMocks.disposeOpenWagglePiSession.mockReset()
    runtimeMocks.getPiAgentDir.mockReset()
    runtimeMocks.resolveSessionProjectPath.mockReset()
    runtimeMocks.sessionManagerCreate.mockReset()
    runtimeMocks.resolveSessionProjectPath.mockReturnValue('/repo')
    runtimeMocks.createSessionManagerForSession.mockReturnValue(sessionManager)
    runtimeMocks.createPiProjectModelRuntime.mockResolvedValue({ model, services })
    runtimeMocks.createOpenWaggleAgentSessionFromServices.mockResolvedValue({ session })
    runtimeMocks.getPiAgentDir.mockReturnValue('/agent-dir')
  })

  it('creates a project-scoped Pi session and disposes it after the operation', async () => {
    const operation = vi.fn(async (operationSession) => ({ id: operationSession.sessionId }))

    const result = await withPiSession(input(), operation)

    expect(result).toEqual({ id: 'pi-session-1' })
    expect(runtimeMocks.createPiProjectModelRuntime).toHaveBeenCalledWith({
      projectPath: '/repo',
      modelReference: MODEL,
      skillToggles: { audit: true },
    })
    expect(runtimeMocks.createOpenWaggleAgentSessionFromServices).toHaveBeenCalledWith({
      services,
      model,
      sessionManager,
    })
    expect(operation).toHaveBeenCalledWith(session)
    expect(runtimeMocks.disposeOpenWagglePiSession).toHaveBeenCalledWith(session)
  })

  it('builds a reusable Pi runtime factory with the OpenWaggle agent directory', async () => {
    runtimeMocks.createAgentSessionRuntime.mockImplementation(
      async (
        createRuntime: (options: RuntimeFactoryOptions) => Promise<unknown>,
        options: RuntimeOptions,
      ) => ({ runtime: await createRuntime({ cwd: options.cwd, sessionManager }), options }),
    )

    const result = await createPiSessionRuntime(input())

    expect(result).toEqual({
      runtime: { session, services, diagnostics: services.diagnostics },
      options: { cwd: '/repo', agentDir: '/agent-dir', sessionManager },
    })
    expect(runtimeMocks.createOpenWaggleAgentSessionFromServices).toHaveBeenCalledWith({
      services,
      model,
      sessionManager,
      sessionStartEvent: undefined,
    })
  })

  it('creates a new Pi session id and session file through the Pi session manager', async () => {
    runtimeMocks.sessionManagerCreate.mockReturnValue({
      getSessionId: () => 'new-pi-session',
      getSessionFile: () => '/repo/new-pi-session.jsonl',
    })

    await expect(createPiSession('/repo')).resolves.toEqual({
      piSessionId: 'new-pi-session',
      piSessionFile: '/repo/new-pi-session.jsonl',
    })
    expect(runtimeMocks.sessionManagerCreate).toHaveBeenCalledWith('/repo')
  })
})
