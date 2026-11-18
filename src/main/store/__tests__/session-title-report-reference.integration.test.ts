import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_TITLE_MAX_LENGTH } from '@shared/session-title'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, updateSessionTitle } from '../session-details'
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

describe('Session projection title report references', () => {
  beforeEach(async () => {
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-title-reference-'))
    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
  })

  afterEach(async () => {
    const temporaryRoot = state.userDataDir
    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('updates the indexed Worker reference with an automatic projection title', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-title-reference',
      piSessionId: 'pi-session-title-reference',
    })
    await updateSessionTitle(session.id, 'Generated Worker Title')

    const references = await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql<{ readonly normalized_reference: string }>`
          SELECT normalized_reference FROM session_report_references
          WHERE session_id = ${session.id} AND kind = ${'title'}
        `,
      ),
    )
    expect(references).toEqual([{ normalized_reference: 'generated worker title' }])
  })

  it('rejects an internal projection title that cannot be a report reference', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-title-bound',
      piSessionId: 'pi-session-title-bound',
    })

    await expect(
      updateSessionTitle(session.id, 'x'.repeat(SESSION_TITLE_MAX_LENGTH + 1)),
    ).rejects.toThrow(`Session title cannot exceed ${SESSION_TITLE_MAX_LENGTH} characters.`)
    await expect(updateSessionTitle(session.id, '   ')).rejects.toThrow(
      'Session title cannot be blank.',
    )
  })

  it('normalizes an internal projection title before persisting its report reference', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-title-normalized',
      piSessionId: 'pi-session-title-normalized',
    })
    await updateSessionTitle(session.id, '  Normalized Worker  ')

    const rows = await runStoreEffect(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ readonly title: string; readonly normalized_reference: string }>`
          SELECT sessions.title, session_report_references.normalized_reference
          FROM sessions JOIN session_report_references
            ON session_report_references.session_id = sessions.id
          WHERE sessions.id = ${session.id} AND session_report_references.kind = ${'title'}
        `,
      ),
    )
    expect(rows).toEqual([
      { title: 'Normalized Worker', normalized_reference: 'normalized worker' },
    ])
  })
})
