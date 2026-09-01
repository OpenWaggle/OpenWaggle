import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, getSessionDetail, persistSessionSnapshot } from '../session-details'

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

beforeEach(async () => {
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-visualization-replay-'),
  )
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(tmpDir, { recursive: true, force: true })
})

describe('inline visualization replay', () => {
  it('replays a persisted reference against its live session source after restart', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-visualization-replay',
      piSessionId: 'pi-session-visualization-replay',
      piSessionFile: '/tmp/pi-session-visualization-replay.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const sourceDirectory = lifecyclePath.join(
      state.userDataDir,
      'visualizations',
      String(sessionId),
    )
    await lifecycleFs.mkdir(sourceDirectory, { recursive: true })
    const sourcePath = lifecyclePath.join(sourceDirectory, 'restart-map.html')
    await lifecycleFs.writeFile(sourcePath, '<main>Live after restart</main>', 'utf8')
    const reference = `visualize${JSON.stringify({ path: sourcePath, title: 'Restart map' })}`

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-visualization-replay',
      piSessionFile: '/tmp/pi-session-visualization-replay.jsonl',
      activeNodeId: 'assistant-visualization',
      nodes: [
        {
          id: 'assistant-visualization',
          parentId: null,
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 10,
          contentJson: JSON.stringify({ parts: [{ type: 'text', text: reference }] }),
          metadataJson: JSON.stringify({ visualizationSessionId: 'source-session' }),
          pathDepth: 0,
          createdOrder: 0,
        },
      ],
    })

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-visualization-replay',
      piSessionFile: '/tmp/pi-session-visualization-replay.jsonl',
      activeNodeId: 'assistant-visualization',
      nodes: [
        {
          id: 'assistant-visualization',
          parentId: null,
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 10,
          contentJson: JSON.stringify({ parts: [{ type: 'text', text: reference }] }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
      ],
    })

    const { runAppEffect, resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
    const reloaded = await getSessionDetail(sessionId)
    const { readInlineVisualizationSource } = await import(
      '../../application/inline-visualization-source-service'
    )
    const liveSource = await runAppEffect(readInlineVisualizationSource({ sessionId, sourcePath }))

    expect(reloaded?.messages[0]?.parts).toEqual([{ type: 'text', text: reference }])
    expect(reloaded?.messages[0]?.metadata?.visualizationSessionId).toBe('source-session')
    expect(liveSource).toMatchObject({
      status: 'loaded',
      contents: '<main>Live after restart</main>',
    })
  })
})
