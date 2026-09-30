import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSession,
  getSessionDetail,
  persistSessionSnapshot,
} from '../../../../store/session-details'
import { createSessionManagerForSession } from '../session-manager'
import { projectPiSessionSnapshot } from '../session-projection'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function appendTurn(sessionManager: SessionManager, text: string, timestamp: number) {
  sessionManager.appendMessage({ role: 'user', content: text, timestamp })
  return sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: `${text} answer` }],
    api: 'openai-responses',
    provider: 'provider',
    model: 'model',
    usage: USAGE,
    stopReason: 'stop',
    timestamp: timestamp + 1,
  })
}

let projectPath = ''

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-resume-position-'))
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-resume-project-'))
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
  await fs.rm(projectPath, { recursive: true, force: true })
})

/**
 * A Session with two conversation branches whose Pi file was last written on the second branch,
 * then switched back to main. The switch is a Pi tree navigation, which Pi keeps in memory.
 */
async function sessionSwitchedBackToMain(options: { readonly withAuditNode?: boolean } = {}) {
  const pi = SessionManager.create(projectPath, projectPath)
  pi.appendModelChange('provider', 'model')
  const forkPoint = appendTurn(pi, 'first', 1)
  const mainHead = appendTurn(pi, 'main', 10)
  pi.branch(forkPoint)
  appendTurn(pi, 'other branch', 20)
  pi.branch(mainHead)

  const piSessionFile = pi.getSessionFile() ?? ''
  const session = await createSession({
    projectPath,
    piSessionId: pi.getSessionId(),
    piSessionFile,
  })
  const snapshot = projectPiSessionSnapshot({ sessionManager: pi })
  // A run's durable agent-loop events live only in the projection, after the Pi entries.
  const auditNodes = options.withAuditNode
    ? [
        {
          id: 'run-1:agent-loop:0',
          parentId: snapshot.activeNodeId,
          piEntryType: 'custom',
          kind: 'custom' as const,
          role: null,
          timestampMs: 50,
          contentJson: JSON.stringify({ customType: 'openwaggle.agent-loop.event', data: {} }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: snapshot.nodes.length,
        },
      ]
    : []
  await persistSessionSnapshot({
    sessionId: SessionId(String(session.id)),
    piSessionId: pi.getSessionId(),
    piSessionFile,
    activeNodeId: snapshot.activeNodeId,
    nodes: [...snapshot.nodes, ...auditNodes],
  })
  const detail = await getSessionDetail(SessionId(String(session.id)))
  if (!detail) throw new Error('Session detail is missing')
  return { detail, mainHead, piSessionFile }
}

describe('Pi session resume position', () => {
  it('continues the branch selected in the projection, not the branch written last', async () => {
    const { detail, mainHead } = await sessionSwitchedBackToMain()

    const reopened = createSessionManagerForSession(detail, projectPath)
    const next = reopened.appendMessage({ role: 'user', content: 'next', timestamp: 30 })

    expect(detail.resumePosition?.nodeId).toBe(mainHead)
    expect(reopened.getEntry(next)?.parentId).toBe(mainHead)
  })

  it('counts only Pi entries, so projected agent-loop events do not disable the resume', async () => {
    const { detail, mainHead } = await sessionSwitchedBackToMain({ withAuditNode: true })

    const reopened = createSessionManagerForSession(detail, projectPath)

    expect(reopened.getLeafId()).toBe(mainHead)
  })

  it('keeps the Pi file position when the file has entries the projection has not seen', async () => {
    const { detail, piSessionFile } = await sessionSwitchedBackToMain()
    const writer = SessionManager.open(piSessionFile, undefined, projectPath)
    const unseen = writer.appendMessage({ role: 'user', content: 'unseen', timestamp: 40 })

    const reopened = createSessionManagerForSession(detail, projectPath)

    expect(reopened.getLeafId()).toBe(unseen)
  })
})
