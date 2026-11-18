import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptSessionWorktreeForSetup,
  claimSessionWorktreeSetup,
  completeSessionWorktreeSetup,
  createSession,
  getPendingSessionWorktreeSetup,
  getSessionDetail,
  getSessionWorktreeSetupDispatch,
  releaseSessionWorktreeSetupClaim,
  resetRecordedSessionWorktreeSetup,
  resetSessionWorktreeSetup,
  setSessionWorktree,
} from '../session-details'

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

let sessionId = SessionId('')

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-worktree-setup-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  const session = await createSession({
    projectPath: '/repo',
    piSessionId: 'setup-session',
    environmentMode: 'worktree',
  })
  sessionId = SessionId(String(session.id))
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('Session worktree Setup dispatch state', () => {
  it('preserves an interrupted birth generation through adoption, then keeps its receipt', async () => {
    const pending = await resetSessionWorktreeSetup(sessionId, '/worktree')

    await expect(adoptSessionWorktreeForSetup(sessionId, '/worktree')).resolves.toEqual(pending)
    await expect(getSessionDetail(sessionId)).resolves.toMatchObject({
      environmentMode: 'worktree',
      worktreePath: '/worktree',
    })

    const claim = await claimSessionWorktreeSetup(sessionId, pending)
    if (!claim) throw new Error('pending Setup dispatch was not claimed')
    await completeSessionWorktreeSetup(sessionId, claim)

    await expect(getPendingSessionWorktreeSetup(sessionId)).resolves.toBeNull()
    await expect(getSessionWorktreeSetupDispatch(sessionId)).resolves.toMatchObject({
      worktreePath: '/worktree',
      generation: pending.generation,
      state: 'accepted',
      claimToken: claim.claimToken,
      acceptedAt: expect.any(Number),
    })
    await expect(adoptSessionWorktreeForSetup(sessionId, '/worktree')).resolves.toBeNull()
  })

  it('gives a manual recreation a new generation and ignores stale completion', async () => {
    await setSessionWorktree(sessionId, 'worktree', '/worktree')
    const first = await resetRecordedSessionWorktreeSetup(sessionId, '/worktree')
    if (!first) throw new Error('recorded worktree was not recognized')
    const firstClaim = await claimSessionWorktreeSetup(sessionId, first)
    if (!firstClaim) throw new Error('first Setup generation was not claimed')
    const second = await resetRecordedSessionWorktreeSetup(sessionId, '/worktree')
    if (!second) throw new Error('recorded worktree was not recognized')

    expect(second.generation).not.toBe(first.generation)
    await completeSessionWorktreeSetup(sessionId, firstClaim)
    await expect(getPendingSessionWorktreeSetup(sessionId)).resolves.toEqual(second)

    const secondClaim = await claimSessionWorktreeSetup(sessionId, second)
    if (!secondClaim) throw new Error('second Setup generation was not claimed')
    await completeSessionWorktreeSetup(sessionId, secondClaim)
    await expect(getPendingSessionWorktreeSetup(sessionId)).resolves.toBeNull()
  })

  it('restores a normal pre-handoff failure to pending so the same generation can retry', async () => {
    const pending = await resetSessionWorktreeSetup(sessionId, '/worktree')
    const firstClaim = await claimSessionWorktreeSetup(sessionId, pending)
    if (!firstClaim) throw new Error('pending Setup dispatch was not claimed')

    await releaseSessionWorktreeSetupClaim(sessionId, firstClaim)

    await expect(getPendingSessionWorktreeSetup(sessionId)).resolves.toEqual(pending)
    const retryClaim = await claimSessionWorktreeSetup(sessionId, pending)
    expect(retryClaim).toMatchObject({
      generation: pending.generation,
      state: 'claimed',
    })
    expect(retryClaim?.claimToken).not.toBe(firstClaim.claimToken)
  })

  it('does not replay a claimed generation after an app-process restart', async () => {
    const pending = await resetSessionWorktreeSetup(sessionId, '/worktree')
    const claim = await claimSessionWorktreeSetup(sessionId, pending)
    if (!claim) throw new Error('pending Setup dispatch was not claimed')

    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()

    await expect(getPendingSessionWorktreeSetup(sessionId)).resolves.toBeNull()
    await expect(claimSessionWorktreeSetup(sessionId, pending)).resolves.toBeNull()
    await expect(adoptSessionWorktreeForSetup(sessionId, '/worktree')).resolves.toBeNull()
    await expect(getSessionWorktreeSetupDispatch(sessionId)).resolves.toEqual(claim)
  })

  it('refuses to schedule automatic Setup for an unowned recreation path', async () => {
    await setSessionWorktree(sessionId, 'worktree', '/recorded-worktree')

    await expect(
      resetRecordedSessionWorktreeSetup(sessionId, '/different-worktree'),
    ).resolves.toBeNull()
    await expect(getPendingSessionWorktreeSetup(sessionId)).resolves.toBeNull()
  })
})
