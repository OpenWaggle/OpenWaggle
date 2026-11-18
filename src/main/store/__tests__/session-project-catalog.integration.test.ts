import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../session-details'
import { hasActiveSessionProjectPath, listSessionProjectPage } from '../sessions/session-catalog'
import { runStoreEffect } from '../store-runtime'

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
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-project-catalog-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const root = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(root, { recursive: true, force: true })
})

describe('session project catalog', () => {
  it('finds Unicode paths and renamed projects beyond the first page', async () => {
    await createSession({ projectPath: '/repo/alpha', piSessionId: 'pi-alpha' })
    await createSession({ projectPath: '/repo/zzz', piSessionId: 'pi-zzz' })
    await createSession({ projectPath: '/repo/Équipe', piSessionId: 'pi-equipe' })
    await createSession({ projectPath: '/repo/cafe\u0301', piSessionId: 'pi-cafe' })

    await expect(listSessionProjectPage(1, undefined, 'éq')).resolves.toEqual({
      paths: ['/repo/Équipe'],
    })
    await expect(listSessionProjectPage(1, undefined, 'Workbench', ['/repo/zzz'])).resolves.toEqual(
      {
        paths: ['/repo/zzz'],
      },
    )
    await expect(listSessionProjectPage(1, undefined, 'café')).resolves.toEqual({
      paths: ['/repo/cafe\u0301'],
    })
  })

  it('authorizes only exact active project paths', async () => {
    await createSession({ projectPath: '/repo/active', piSessionId: 'pi-active' })
    const archived = await createSession({
      projectPath: '/repo/archived',
      piSessionId: 'pi-archived',
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET archived = 1 WHERE id = ${archived.id}`
      }),
    )
    await expect(hasActiveSessionProjectPath(['/repo/active'])).resolves.toBe(true)
    await expect(hasActiveSessionProjectPath(['/repo/archived'])).resolves.toBe(false)
    await expect(hasActiveSessionProjectPath(['/repo/unknown'])).resolves.toBe(false)
  })

  it('invalidates the Unicode search cache after create, archive, and path changes', async () => {
    await expect(listSessionProjectPage(10, undefined, 'éq')).resolves.toEqual({ paths: [] })
    const session = await createSession({ projectPath: '/repo/Équipe', piSessionId: 'pi-cache' })
    await expect(listSessionProjectPage(10, undefined, 'éq')).resolves.toEqual({
      paths: ['/repo/Équipe'],
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET project_path = ${'/repo/Éclair'} WHERE id = ${session.id}`
      }),
    )
    await expect(listSessionProjectPage(10, undefined, 'éq')).resolves.toEqual({ paths: [] })
    await expect(listSessionProjectPage(10, undefined, 'écl')).resolves.toEqual({
      paths: ['/repo/Éclair'],
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET archived = 1 WHERE id = ${session.id}`
      }),
    )
    await expect(listSessionProjectPage(10, undefined, 'écl')).resolves.toEqual({ paths: [] })
  })

  it('ignores legacy Sessions without a project path while building the Unicode cache', async () => {
    const legacy = await createSession({ projectPath: '/repo/legacy', piSessionId: 'pi-null-path' })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET project_path = NULL WHERE id = ${legacy.id}`
      }),
    )
    await expect(listSessionProjectPage(10, undefined, 'éq')).resolves.toEqual({ paths: [] })
  })

  it('matches ASCII queries against Unicode case folds in project paths', async () => {
    await createSession({ projectPath: '/repo/İstanbul', piSessionId: 'pi-istanbul' })
    await createSession({ projectPath: '/repo/Kode', piSessionId: 'pi-kode' })
    await expect(listSessionProjectPage(10, undefined, 'i')).resolves.toEqual({
      paths: ['/repo/İstanbul'],
    })
    await expect(listSessionProjectPage(10, undefined, 'k')).resolves.toEqual({
      paths: ['/repo/Kode'],
    })
  })
})
