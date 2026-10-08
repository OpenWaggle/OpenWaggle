import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { HostUiSessionResourceChannel } from '../../../application/host-ui-session-resource-operation-dispatcher'
import type { AppServices } from '../../../runtime'
import {
  createPiCliSession,
  discoverOne,
  openSession,
  registerProjects,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'

/**
 * The Resources panel of a discovered Pi session (ADR 0048), whose node ids carry the Session's
 * prefix (`<sessionId>/<entryId>`).
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

const fixture = setUpPiDiscoveryFixture(state)

async function resourceOperation(channel: HostUiSessionResourceChannel, args: readonly unknown[]) {
  const { dispatchHostUiSessionResourceOperation } = await import(
    '../../../application/host-ui-session-resource-operation-dispatcher'
  )
  const operation: Effect.Effect<unknown, unknown, AppServices> =
    dispatchHostUiSessionResourceOperation(channel, args)
  return run(operation)
}

/** A discovered session whose messages link a page, opened so its nodes are projected. */
async function discoveredSessionWithLink() {
  await registerProjects([fixture.project])
  createPiCliSession(fixture.project, 'Read [the guide](https://example.com/guide) please')
  const sessionId = await discoverOne()
  await openSession(sessionId)
  const { SessionRepository } = await import('../../../ports/session-repository')
  const tree = await run(
    Effect.flatMap(SessionRepository, (repository) => repository.getTree(sessionId)),
  )
  const detail = await sessionDetail(sessionId)
  if (!tree || !detail) throw new Error('The discovered Session has no tree.')
  await resourceOperation('sessions:resources:backfill', [sessionId])
  return {
    sessionId,
    branchId: tree.branches[0]?.id ?? null,
    nodeIds: detail.messages.map((message) => String(message.id)),
  }
}

describe('Resources of a discovered Pi session', () => {
  it('pages the resources of the selected branch', async () => {
    const { sessionId, branchId, nodeIds } = await discoveredSessionWithLink()
    expect(nodeIds.every((nodeId) => nodeId.startsWith(`${sessionId}/`))).toBe(true)

    const page = await resourceOperation('sessions:resources:page', [
      sessionId,
      { view: 'all', limit: 20, selection: { branchId, pathNodeIds: nodeIds } },
    ])

    expect(page).toMatchObject({
      resources: [{ kind: 'link', locator: 'https://example.com/guide' }],
    })
  })

  it("pages the resources of a message's nodes", async () => {
    const { sessionId, nodeIds } = await discoveredSessionWithLink()

    const page = await resourceOperation('sessions:resources:node-page', [
      sessionId,
      { nodeIds, kind: null, limit: 20 },
    ])

    expect(page).toMatchObject({
      resources: [{ kind: 'link', locator: 'https://example.com/guide' }],
    })
  })
})
