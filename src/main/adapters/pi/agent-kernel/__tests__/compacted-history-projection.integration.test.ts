import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { getMessageText } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { buildPiModelContextPath } from '@shared/utils/session-entry-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSession,
  getSessionDetail,
  persistSessionSnapshot,
} from '../../../../store/session-details'
import { getSessionWorkspace } from '../../../../store/sessions'
import { projectPiSessionSnapshot } from '../session-projection'

/*
 * ADR 0048: the transcript keeps the history a compaction summarized, while the model keeps working
 * from Pi's compacted context. These Sessions are written by Pi's own SessionManager, projected
 * and saved the way a Run or a manual compaction saves them, and read back as the renderer reads
 * them. Pi's context is read from the same SessionManager.
 */

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

const NATIVE_DETAILS = {
  schemaVersion: 1,
  mechanism: 'native',
  identity: {
    api: 'openai-responses',
    provider: 'provider',
    baseUrl: 'https://provider.example.test/v1',
    compactionBaseUrl: 'https://provider.example.test/v1',
    modelId: 'model',
  },
  items: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' }],
}

let projectPath = ''

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-compacted-history-'))
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-compacted-history-project-'))
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
  await fs.rm(projectPath, { recursive: true, force: true })
})

/** One user prompt and its answer; returns both entry ids. */
function appendTurn(pi: SessionManager, text: string, timestamp: number) {
  const user = pi.appendMessage({ role: 'user', content: text, timestamp })
  const assistant = pi.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: `${text} answer` }],
    api: 'openai-responses',
    provider: 'provider',
    model: 'model',
    usage: USAGE,
    stopReason: 'stop',
    timestamp: timestamp + 1,
  })
  return { user, assistant }
}

async function saveAndRead(pi: SessionManager) {
  const snapshot = projectPiSessionSnapshot({ sessionManager: pi })
  const session = await createSession({
    projectPath,
    piSessionId: pi.getSessionId(),
    piSessionFile: path.join(projectPath, 'pi.jsonl'),
  })
  const sessionId = SessionId(String(session.id))
  await persistSessionSnapshot({
    sessionId,
    piSessionId: pi.getSessionId(),
    piSessionFile: path.join(projectPath, 'pi.jsonl'),
    ...snapshot,
  })
  const detail = await getSessionDetail(session.id)
  const workspace = await getSessionWorkspace(sessionId)
  return {
    transcript: (detail?.messages ?? []).map((message) =>
      message.metadata?.compactionSummary ? 'marker' : getMessageText(message),
    ),
    workspaceIds: workspace?.transcriptPath.map((entry) => String(entry.node.id)),
    detailIds: detail?.messages.map((message) => String(message.id)),
    modelContextIds: buildPiModelContextPath(snapshot.activeNodeId, snapshot.nodes, {
      getId: (node) => node.id,
      getParentId: (node) => node.parentId,
      getKind: (node) => node.kind,
      getContentJson: (node) => node.contentJson,
    }).map((node) => node.id),
  }
}

/** The entries Pi's model context comes from: those that project at least one message. */
function piContextEntryIds(pi: SessionManager) {
  return pi
    .buildSessionProjection()
    .entries.filter((entry) => entry.messages.length > 0)
    .map((entry) => entry.sourceEntry.id)
}

function piContextRoles(pi: SessionManager) {
  return pi.buildSessionContext().messages.map((message) => message.role)
}

describe('compacted history in the projected transcript', () => {
  it('shows every earlier message above a Portable marker while Pi keeps its compacted context', async () => {
    const pi = SessionManager.inMemory(projectPath)
    appendTurn(pi, 'first', 1)
    const kept = appendTurn(pi, 'second', 10)
    pi.appendCompaction(
      'Portable checkpoint',
      kept.user,
      4_200,
      undefined,
      false,
      undefined,
      'manual',
    )
    appendTurn(pi, 'third', 20)

    const read = await saveAndRead(pi)

    expect(read.transcript).toEqual([
      'first',
      'first answer',
      'second',
      'second answer',
      'marker',
      'third',
      'third answer',
    ])
    expect(read.workspaceIds).toEqual(read.detailIds)
    // The model still starts at the checkpoint, then the kept turn and what followed.
    expect(piContextRoles(pi)).toEqual([
      'compactionSummary',
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(read.modelContextIds).toEqual(piContextEntryIds(pi))
  })

  it('shows every earlier message above a Native checkpoint that keeps none for the model', async () => {
    const pi = SessionManager.inMemory(projectPath)
    appendTurn(pi, 'first', 1)
    appendTurn(pi, 'second', 10)
    pi.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )
    appendTurn(pi, 'third', 20)

    const read = await saveAndRead(pi)

    expect(read.transcript).toEqual([
      'first',
      'first answer',
      'second',
      'second answer',
      'marker',
      'third',
      'third answer',
    ])
    expect(read.workspaceIds).toEqual(read.detailIds)
    const modelContext = piContextEntryIds(pi)
    expect(modelContext).toHaveLength(3)
    expect(read.modelContextIds).toEqual(modelContext)
  })

  it('gives a branch from a message above the marker that branch’s own uncompacted context', async () => {
    const pi = SessionManager.inMemory(projectPath)
    const earlier = appendTurn(pi, 'first', 1)
    const kept = appendTurn(pi, 'second', 10)
    pi.appendCompaction(
      'Portable checkpoint',
      kept.user,
      4_200,
      undefined,
      false,
      undefined,
      'manual',
    )
    // What a branch, or an edit and resend, from the first answer does through Pi's tree.
    pi.branch(earlier.assistant)
    pi.appendMessage({ role: 'user', content: 'retry from first', timestamp: 30 })

    const read = await saveAndRead(pi)

    expect(read.transcript).toEqual(['first', 'first answer', 'retry from first'])
    expect(read.workspaceIds).toEqual(read.detailIds)
    expect(piContextRoles(pi)).toEqual(['user', 'assistant', 'user'])
    expect(read.modelContextIds).toEqual(piContextEntryIds(pi))
  })
})
