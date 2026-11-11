import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import {
  createPiCliSession,
  discoverOne,
  openSession,
  registerProjects,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from '../pi/__tests__/pi-session-discovery.test-support'

/**
 * Deleting the Session of a discovered Pi session keeps every file of its transcript: the file
 * is the program's history, not a copy OpenWaggle owns (ADR 0051).
 */

const { state } = vi.hoisted(() => ({
  state: { userDataDir: '' },
}))

// Each test keeps its files under its own `userData`.
vi.mock('../../desktop-shell/app-paths', async () => {
  const { fakeAppPaths } = await import('../../test-support/fake-desktop-shell')
  return { appPaths: { ...fakeAppPaths(), userData: () => state.userDataDir } }
})

// Load the app runtime while the file is collected, so the fixture's first hook only resets it.
await import('../../runtime')

const fixture = setUpPiDiscoveryFixture(state)

describe('Deleting the Session of a discovered Pi session', () => {
  it("keeps every file of the discovered Pi session's transcript", async () => {
    await registerProjects([fixture.project])
    const cli = createPiCliSession(fixture.project, 'Keep my history')
    const sessionId = await discoverOne()
    await openSession(sessionId)
    // Another file of the same Pi session, which deleting an owned Session would remove.
    const sibling = path.join(path.dirname(cli.file), `2020-01-01T00-00-00-000Z_${cli.id}.jsonl`)
    await fs.copyFile(cli.file, sibling)

    await run(
      Effect.flatMap(SessionProjectionRepository, (repository) => repository.delete(sessionId)),
    )

    expect(await sessionDetail(sessionId)).toBeNull()
    expect(existsSync(cli.file)).toBe(true)
    expect(existsSync(sibling)).toBe(true)
  })
})
