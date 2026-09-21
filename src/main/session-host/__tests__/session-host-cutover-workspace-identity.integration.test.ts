import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { validateSessionHostTarget } from '../session-host-cutover-validation'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

describe('Session Host cutover Workspace identity', () => {
  let temporaryRoot = ''
  let sourceDatabasePath = ''
  let targetDatabasePath = ''
  let recoveryDatabasePath = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-workspace-'))
    sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps same-path legacy worktrees isolated by project identity', async () => {
    seedLegacyDatabase(sourceDatabasePath)
    const sharedWorktreePath = path.join(temporaryRoot, 'shared-worktree')
    const source = new DatabaseSync(sourceDatabasePath)
    try {
      const insert = source.prepare(`
        INSERT INTO sessions (
          id, pi_session_id, project_path, title, created_at, updated_at,
          environment_mode, worktree_path
        ) VALUES (?, ?, ?, ?, ?, ?, 'worktree', ?)
      `)
      insert.run(
        'session-project-a',
        'pi-project-a',
        '/project-a',
        'Project A',
        30,
        31,
        sharedWorktreePath,
      )
      insert.run(
        'session-project-b',
        'pi-project-b',
        '/project-b',
        'Project B',
        32,
        33,
        sharedWorktreePath,
      )
    } finally {
      source.close()
    }

    await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      Date.now(),
      fakeEmbeddingModel,
    )

    const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
    try {
      const rows = target
        .prepare(`
          SELECT sessions.id AS session_id, sessions.project_path AS session_project_path,
            workspace_resources.id AS workspace_id,
            workspace_resources.project_path AS workspace_project_path,
            workspace_resources.working_path
          FROM sessions
          JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
          JOIN workspace_resources
            ON workspace_resources.id = session_workspace_bindings.workspace_id
          WHERE sessions.id IN ('session-project-a', 'session-project-b')
          ORDER BY sessions.id
        `)
        .all()
        .map((value) => {
          if (typeof value !== 'object' || value === null) {
            throw new Error('Workspace binding row is invalid.')
          }
          return Object.fromEntries(Object.entries(value))
        })

      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.session_project_path)).toEqual(['/project-a', '/project-b'])
      expect(rows.map((row) => row.workspace_project_path)).toEqual(['/project-a', '/project-b'])
      expect(rows.map((row) => row.working_path)).toEqual([sharedWorktreePath, sharedWorktreePath])
      expect(rows[0]?.workspace_id).not.toBe(rows[1]?.workspace_id)
    } finally {
      target.close()
    }
  })

  it('fails closed when a Workspace binding crosses project identity', async () => {
    seedLegacyDatabase(sourceDatabasePath)
    await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      Date.now(),
      fakeEmbeddingModel,
    )
    const target = new DatabaseSync(targetDatabasePath)
    try {
      target
        .prepare(`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state,
            worktree_start_from_origin, created_at, updated_at
          ) VALUES (?, ?, 'local', ?, 'ready', 0, ?, ?)
        `)
        .run('workspace-other-project', '/other-project', '/other-project', 40, 40)
      target
        .prepare(`
          UPDATE session_workspace_bindings SET workspace_id = ? WHERE session_id = ?
        `)
        .run('workspace-other-project', 'session-root')
      expect(() =>
        validateSessionHostTarget(target, undefined, fakeEmbeddingModel.metadata, {
          requireCompleteSemanticCoverage: false,
        }),
      ).toThrow('Workspace binding project identity does not match its Session')
    } finally {
      target.close()
    }
  })
})
