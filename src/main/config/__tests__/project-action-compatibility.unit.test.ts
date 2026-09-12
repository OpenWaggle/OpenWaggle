import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addProjectAction,
  discoverT3ProjectActions,
  importT3ProjectAction,
  listProjectActions,
  updateProjectAction,
} from '../project-actions'

describe('project action compatibility', () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-project-actions-'))
  })

  afterEach(async () => {
    await rm(projectPath, { force: true, recursive: true })
  })

  function settingsPath() {
    return path.join(projectPath, '.openwaggle', 'settings.json')
  }

  async function writeSettings(settings: unknown) {
    await mkdir(path.dirname(settingsPath()), { recursive: true })
    await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
  }

  it('canonicalizes address-style previews and rejects unsafe URLs', async () => {
    const actions = await addProjectAction(projectPath, {
      name: 'Preview',
      command: 'pnpm dev',
      previewUrl: ' localhost:5173/app ',
    })
    expect(actions[0]?.previewUrl).toBe('http://localhost:5173/app')

    await expect(
      addProjectAction(projectPath, {
        name: 'Credentials',
        command: 'pnpm unsafe',
        previewUrl: 'https://user:secret@example.com/',
      }),
    ).rejects.toThrow('Preview URL must be a valid HTTP or HTTPS address')
  })

  it('preserves unknown fields attached to an edited action', async () => {
    await writeSettings({
      actions: [
        {
          id: 'test',
          name: 'Test',
          command: 'pnpm test',
          icon: 'test',
          runOnWorktreeCreate: false,
          futureMetadata: { source: 'future-version' },
        },
      ],
    })

    await updateProjectAction(projectPath, 'test', { command: 'pnpm test --run' })

    const persisted = await readFile(settingsPath(), 'utf-8')
    expect(persisted).toContain('"futureMetadata"')
    expect(persisted).toContain('"pnpm test --run"')
  })

  it('opens leniently but refuses strict writes to invalid saved actions', async () => {
    const invalidSettings = {
      actions: [
        {
          id: 'first',
          name: 'First',
          command: 'one',
          icon: 'play',
          runOnWorktreeCreate: true,
        },
        {
          id: 'second',
          name: 'Second',
          command: 'two',
          icon: 'play',
          runOnWorktreeCreate: true,
        },
      ],
    }
    await writeSettings(invalidSettings)
    const before = await readFile(settingsPath(), 'utf-8')

    expect(await listProjectActions(projectPath)).toEqual([])
    await expect(
      addProjectAction(projectPath, { name: 'Safe', command: 'pnpm safe' }),
    ).rejects.toThrow('Only one project action')
    expect(await readFile(settingsPath(), 'utf-8')).toBe(before)
  })

  it('deduplicates t3.json candidates and imports by trusted source index', async () => {
    await addProjectAction(projectPath, {
      name: 'Setup',
      command: 'pnpm install',
      runOnWorktreeCreate: true,
    })
    await writeFile(
      path.join(projectPath, 't3.json'),
      JSON.stringify({
        scripts: [
          { name: 'Install copy', command: 'pnpm install' },
          { name: 'SETUP', command: 'different' },
          { name: 'Dev', command: 'pnpm dev', runOnWorktreeCreate: true },
          { name: 'dev', command: 'another dev' },
        ],
      }),
      'utf-8',
    )

    const discovered = await discoverT3ProjectActions(projectPath)
    expect(discovered.status).toBe('valid')
    expect(discovered.scripts).toHaveLength(4)
    expect(discovered.candidates.map((candidate) => candidate.sourceIndex)).toEqual([2])

    const imported = await importT3ProjectAction(projectPath, 2)
    expect(imported.map(({ id, runOnWorktreeCreate }) => ({ id, runOnWorktreeCreate }))).toEqual([
      { id: 'setup', runOnWorktreeCreate: false },
      { id: 'dev', runOnWorktreeCreate: true },
    ])
    await expect(importT3ProjectAction(projectPath, 2)).rejects.toThrow('already imported')
  })
})
