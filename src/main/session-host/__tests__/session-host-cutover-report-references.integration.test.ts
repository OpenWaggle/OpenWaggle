import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { validateSessionReportReferenceCatalog } from '../session-host-report-reference-catalog'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

describe('Session Host report-reference cutover', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-reference-cutover-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each([
    {
      title: '  İNCELEME  ',
      expected: [
        { kind: 'session-id', normalized_reference: 'session-root' },
        { kind: 'title', normalized_reference: 'i̇nceleme' },
      ],
    },
    {
      title: '   ',
      expected: [{ kind: 'session-id', normalized_reference: 'session-root' }],
    },
  ])(
    'normalizes and indexes the legacy title $title during cutover',
    async ({ title, expected }) => {
      const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
      const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
      const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
      seedLegacyDatabase(sourceDatabasePath)
      const source = new DatabaseSync(sourceDatabasePath)
      try {
        source.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, 'session-root')
      } finally {
        source.close()
      }

      await runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        1_000,
        fakeEmbeddingModel,
      )
      const target = new DatabaseSync(targetDatabasePath)
      try {
        const references = target
          .prepare(`SELECT kind, normalized_reference FROM session_report_references
          WHERE session_id = 'session-root' ORDER BY kind`)
          .all()
        expect(references).toEqual(expected)
        if (title.trim().length === 0) {
          target
            .prepare('UPDATE session_execution_profiles SET profile_json = ? WHERE session_id = ?')
            .run('{"agentDefinitionName":"   "}', 'session-root')
          expect(() => validateSessionReportReferenceCatalog(target)).not.toThrow()
        }
      } finally {
        target.close()
      }
    },
  )
})
