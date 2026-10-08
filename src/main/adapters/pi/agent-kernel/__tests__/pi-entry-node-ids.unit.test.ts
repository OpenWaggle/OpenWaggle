import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { piEntryNodeIds } from '../pi-entry-node-ids'
import { createSessionManagerForSession } from '../session-manager'
import { projectPiSessionSnapshot } from '../session-projection'

/**
 * A discovered Pi session keys its nodes under a per-Session prefix (ADR 0050), so a `pi` CLI fork
 * that copied another session's entry ids never collides with it, and the file is never rewritten.
 */

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pi-node-ids-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const PREFIX = 'session-1/'

function piSession() {
  const sessionManager = SessionManager.create(root, root)
  const first = sessionManager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: 'First' }],
    timestamp: 1,
  })
  // Pi writes the file once it holds an assistant reply.
  const second = sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Second' }],
    api: 'openai-completions',
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 2,
  })
  const compaction = sessionManager.appendCompaction('Summary', second, 10)
  const label = sessionManager.appendLabelChange(first, 'start')
  return { sessionManager, first, second, compaction, label }
}

function discoveredSession(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SessionId('session-1'),
    title: 'Discovered',
    projectPath: root,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    piEntryNodeIdPrefix: PREFIX,
    ...overrides,
  }
}

describe('Pi entry node ids', () => {
  it('projects every node id, parent, leaf, and entry reference under the prefix', () => {
    const { sessionManager, first, second, compaction, label } = piSession()

    const snapshot = projectPiSessionSnapshot(
      { sessionManager },
      piEntryNodeIds(discoveredSession()),
    )

    expect(snapshot.activeNodeId).toBe(`${PREFIX}${label}`)
    expect(snapshot.nodes.map((node) => [node.id, node.parentId])).toEqual([
      [`${PREFIX}${first}`, null],
      [`${PREFIX}${second}`, `${PREFIX}${first}`],
      [`${PREFIX}${compaction}`, `${PREFIX}${second}`],
      [`${PREFIX}${label}`, `${PREFIX}${compaction}`],
    ])
    expect(JSON.parse(snapshot.nodes[2]?.contentJson ?? '{}')).toMatchObject({
      firstKeptEntryId: `${PREFIX}${second}`,
    })
    expect(JSON.parse(snapshot.nodes[3]?.contentJson ?? '{}')).toMatchObject({
      targetId: `${PREFIX}${first}`,
    })
  })

  it('keeps entry ids for Sessions OpenWaggle created', () => {
    const { sessionManager, first } = piSession()

    const snapshot = projectPiSessionSnapshot(
      { sessionManager },
      piEntryNodeIds(discoveredSession({ piEntryNodeIdPrefix: undefined })),
    )

    expect(snapshot.nodes[0]?.id).toBe(first)
  })

  it('resumes a prefixed node as the Pi entry it names', () => {
    const { sessionManager, first } = piSession()
    const file = sessionManager.getSessionFile()
    if (!file) throw new Error('Pi did not write the session file.')

    const reopened = createSessionManagerForSession(
      discoveredSession({
        piSessionFile: file,
        resumePosition: { nodeId: SessionNodeId(`${PREFIX}${first}`), piEntryCount: 4 },
      }),
      root,
    )

    expect(reopened.getLeafId()).toBe(first)
  })
})
