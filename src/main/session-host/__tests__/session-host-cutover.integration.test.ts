import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

describe('Session Host full cutover', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('builds and validates the target beside the source, then retains one recovery copy', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)
    const source = new DatabaseSync(sourceDatabasePath)
    try {
      source.prepare('UPDATE session_nodes SET content_json = ? WHERE id = ?').run(
        JSON.stringify({
          parts: [
            { type: 'text', text: 'Visible cutover message' },
            { type: 'reasoning', text: 'private cutover reasoning' },
          ],
        }),
        'node-1',
      )
    } finally {
      source.close()
    }

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        1_000,
        fakeEmbeddingModel,
      ),
    ).resolves.toMatchObject({ status: 'migrated', sessionCount: 1, nodeCount: 1 })
    await expect(fs.access(sourceDatabasePath)).rejects.toThrow()
    await expect(fs.access(recoveryDatabasePath)).resolves.toBeUndefined()

    const target = new DatabaseSync(targetDatabasePath, { readOnly: true })
    try {
      expect(
        target
          .prepare(`
            SELECT
              session_control_states.queue_state,
              session_execution_profiles.authorization_ceiling,
              session_execution_profiles.profile_json,
              session_runs.status,
              workspace_resources.working_path
            FROM sessions
            JOIN session_control_states ON session_control_states.session_id = sessions.id
            JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
            JOIN session_runs ON session_runs.session_id = sessions.id
            JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
            JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
          `)
          .get(),
      ).toMatchObject({
        queue_state: 'paused',
        authorization_ceiling: 'ask-for-approval',
        profile_json: '{"modelId":"openai/gpt-5.4","thinkingLevel":"high"}',
        status: 'interrupted-by-host-loss',
        working_path: '/project',
      })
      expect(
        target.prepare(`SELECT content FROM session_node_search WHERE node_id = 'node-1'`).get(),
      ).toMatchObject({ content: 'Visible cutover message' })
    } finally {
      target.close()
    }

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        Date.now(),
        fakeEmbeddingModel,
      ),
    ).resolves.toMatchObject({ status: 'already-complete' })
  })

  it('accepts an idle Session whose model remains unresolved until its first configured Run', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)
    await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      Date.now(),
      fakeEmbeddingModel,
    )
    const target = new DatabaseSync(targetDatabasePath)
    try {
      target
        .prepare(`UPDATE session_execution_profiles SET profile_json = ?`)
        .run('{"modelId":"","thinkingLevel":"medium"}')
    } finally {
      target.close()
    }

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        Date.now(),
        fakeEmbeddingModel,
      ),
    ).resolves.toMatchObject({ status: 'already-complete' })
  })

  it('preserves the effective global approval ceiling when a Session has no override', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)
    const source = new DatabaseSync(sourceDatabasePath)
    try {
      source.prepare('UPDATE sessions SET authorization_mode_override = NULL').run()
      source
        .prepare(`UPDATE settings_store SET value_json = '"ask-for-approval"'
          WHERE key = 'defaultAuthorizationMode'`)
        .run()
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
      expect(
        target.prepare('SELECT authorization_ceiling FROM session_execution_profiles').get(),
      ).toMatchObject({ authorization_ceiling: 'ask-for-approval' })
    } finally {
      target.close()
    }
  })

  it('accepts a recoverable pending semantic projection on normal restart', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)
    await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      Date.now(),
      fakeEmbeddingModel,
    )
    const target = new DatabaseSync(targetDatabasePath)
    try {
      target.prepare(`UPDATE sessions SET title = 'Updated before shutdown'`).run()
    } finally {
      target.close()
    }

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        Date.now(),
        fakeEmbeddingModel,
      ),
    ).resolves.toMatchObject({ status: 'already-complete' })
  })

  it('assigns an unmaterialized legacy worktree plan one canonical Workspace path and branch', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath)
    const source = new DatabaseSync(sourceDatabasePath)
    try {
      source
        .prepare(`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, created_at, updated_at,
            environment_mode, worktree_base_ref, worktree_start_from_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run('session-planned', 'pi-planned', '/project', 'Planned', 30, 31, 'worktree', 'main', 0)
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
      const value = target
        .prepare(`
          SELECT workspace_resources.id, workspace_resources.working_path,
            workspace_resources.worktree_branch, workspace_resources.lifecycle_state
          FROM session_workspace_bindings
          JOIN workspace_resources
            ON workspace_resources.id = session_workspace_bindings.workspace_id
          WHERE session_workspace_bindings.session_id = 'session-planned'
        `)
        .get()
      if (typeof value !== 'object' || value === null) throw new Error('Workspace row missing.')
      const row = Object.fromEntries(Object.entries(value))

      expect(row.lifecycle_state).toBe('pending')
      expect(row.working_path).toContain(`/.openwaggle/worktrees/project/${String(row.id)}`)
      expect(row.worktree_branch).toBe(`ow/session-${String(row.id)}`)
      expect(row.working_path).not.toContain('pending://')
    } finally {
      target.close()
    }
  })

  it('leaves the source untouched when target transformation fails', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(sourceDatabasePath, 'not-json')

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        Date.now(),
        fakeEmbeddingModel,
      ),
    ).rejects.toThrow()
    await expect(fs.access(sourceDatabasePath)).resolves.toBeUndefined()
    await expect(fs.access(targetDatabasePath)).rejects.toThrow()
    await expect(fs.access(recoveryDatabasePath)).rejects.toThrow()
  })

  it('finishes installing a validated staged database after a crash between renames', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    const stagingPath = `${targetDatabasePath}.partial`
    seedLegacyDatabase(sourceDatabasePath)
    await runSessionHostCutover(
      { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
      Date.now(),
      fakeEmbeddingModel,
    )
    await fs.rename(targetDatabasePath, stagingPath)

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        Date.now(),
        fakeEmbeddingModel,
      ),
    ).resolves.toMatchObject({ status: 'already-complete', targetDatabasePath })
    await expect(fs.access(targetDatabasePath)).resolves.toBeUndefined()
    await expect(fs.access(stagingPath)).rejects.toThrow()
    await expect(fs.access(recoveryDatabasePath)).resolves.toBeUndefined()
  })

  it('fails closed when only the pre-cutover recovery database remains', async () => {
    const sourceDatabasePath = path.join(temporaryRoot, 'openwaggle.db')
    const targetDatabasePath = path.join(temporaryRoot, 'session-host', 'session-host.sqlite')
    const recoveryDatabasePath = path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db')
    seedLegacyDatabase(recoveryDatabasePath)

    await expect(
      runSessionHostCutover(
        { sourceDatabasePath, targetDatabasePath, recoveryDatabasePath },
        Date.now(),
        fakeEmbeddingModel,
      ),
    ).rejects.toThrow('Session Host cutover is incomplete')
    await expect(fs.access(targetDatabasePath)).rejects.toThrow()
    await expect(fs.access(recoveryDatabasePath)).resolves.toBeUndefined()
  })
})
