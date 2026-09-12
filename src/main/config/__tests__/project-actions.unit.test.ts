import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addProjectAction,
  deleteProjectAction,
  listProjectActions,
  nextProjectActionId,
  updateProjectAction,
} from '../project-actions'

describe('project actions', () => {
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

  it('allocates safe deterministic ids with bounded suffixes', () => {
    expect(nextProjectActionId(' Run Tests! ', [])).toBe('run-tests')
    expect(nextProjectActionId('Run Tests', ['run-tests'])).toBe('run-tests-2')
    expect(nextProjectActionId('!!!', [])).toBe('script')

    const longId = nextProjectActionId('a'.repeat(100), ['a'.repeat(24)])
    expect(longId).toBe(`${'a'.repeat(22)}-2`)
    expect(longId).toHaveLength(24)
  })

  it('normalizes add, update, and delete operations', async () => {
    const added = await addProjectAction(projectPath, {
      name: '  Dev server  ',
      command: '  pnpm dev  ',
      previewUrl: '  http://localhost:5173  ',
      autoOpenPreview: true,
      shortcutRules: [{ shortcut: { key: ' K ', mod: true, shift: false } }],
    })

    expect(added).toEqual([
      {
        id: 'dev-server',
        name: 'Dev server',
        command: 'pnpm dev',
        icon: 'play',
        runOnWorktreeCreate: false,
        previewUrl: 'http://localhost:5173/',
        autoOpenPreview: true,
        shortcutRules: [{ shortcut: { key: 'K', mod: true }, order: 0 }],
      },
    ])

    const updated = await updateProjectAction(projectPath, 'dev-server', {
      command: 'pnpm dev --host',
      previewUrl: null,
      autoOpenPreview: true,
      shortcutRules: null,
    })
    expect(updated).toEqual([
      {
        id: 'dev-server',
        name: 'Dev server',
        command: 'pnpm dev --host',
        icon: 'play',
        runOnWorktreeCreate: false,
      },
    ])

    expect(await deleteProjectAction(projectPath, 'dev-server')).toEqual([])
  })

  it('atomically keeps only the latest setup action', async () => {
    await addProjectAction(projectPath, {
      name: 'Install',
      command: 'pnpm install',
      icon: 'configure',
      runOnWorktreeCreate: true,
    })
    const afterAdd = await addProjectAction(projectPath, {
      name: 'Generate',
      command: 'pnpm generate',
      runOnWorktreeCreate: true,
    })
    expect(afterAdd.map(({ id, runOnWorktreeCreate }) => ({ id, runOnWorktreeCreate }))).toEqual([
      { id: 'install', runOnWorktreeCreate: false },
      { id: 'generate', runOnWorktreeCreate: true },
    ])

    const afterUpdate = await updateProjectAction(projectPath, 'install', {
      runOnWorktreeCreate: true,
    })
    expect(afterUpdate.map(({ id, runOnWorktreeCreate }) => ({ id, runOnWorktreeCreate }))).toEqual(
      [
        { id: 'install', runOnWorktreeCreate: true },
        { id: 'generate', runOnWorktreeCreate: false },
      ],
    )
  })

  it('serializes concurrent writes and preserves loose settings fields', async () => {
    await writeSettings({ futureTopLevel: { enabled: true } })

    await Promise.all([
      addProjectAction(projectPath, { name: 'Test', command: 'pnpm test' }),
      addProjectAction(projectPath, { name: 'Lint', command: 'pnpm lint' }),
    ])

    expect((await listProjectActions(projectPath)).map((action) => action.id).sort()).toEqual([
      'lint',
      'test',
    ])
    expect(await readFile(settingsPath(), 'utf-8')).toContain('"futureTopLevel"')
    const configFiles = await readdir(path.dirname(settingsPath()))
    expect(configFiles).toEqual(['settings.json'])
  })

  it('serializes initialization when concurrent writes create the settings file', async () => {
    await Promise.all([
      addProjectAction(projectPath, { name: 'Test', command: 'pnpm test' }),
      addProjectAction(projectPath, { name: 'Lint', command: 'pnpm lint' }),
    ])

    expect((await listProjectActions(projectPath)).map((action) => action.id).sort()).toEqual([
      'lint',
      'test',
    ])
  })

  it('preserves modifier-free bindings accepted by the T3 config contract', async () => {
    expect(
      await addProjectAction(projectPath, {
        name: 'Function key',
        command: 'pnpm test',
        shortcutRules: [{ shortcut: { key: 'F6' } }],
      }),
    ).toEqual([
      expect.objectContaining({
        shortcutRules: [{ shortcut: { key: 'F6' }, order: 0 }],
      }),
    ])
  })

  it('keeps legacy shortcuts readable and only migrates them after a write', async () => {
    await writeSettings({
      actions: [
        {
          id: 'test',
          name: 'Test',
          command: 'pnpm test',
          icon: 'test',
          runOnWorktreeCreate: false,
          shortcut: { key: 'T', mod: true },
        },
      ],
    })
    const before = await readFile(settingsPath(), 'utf-8')

    expect(await listProjectActions(projectPath)).toEqual([
      {
        id: 'test',
        name: 'Test',
        command: 'pnpm test',
        icon: 'test',
        runOnWorktreeCreate: false,
        shortcutRules: [{ shortcut: { key: 'T', mod: true } }],
      },
    ])
    expect(await readFile(settingsPath(), 'utf-8')).toBe(before)

    await updateProjectAction(projectPath, 'test', { command: 'pnpm test --run' })
    const migrated = await readFile(settingsPath(), 'utf-8')
    expect(JSON.parse(migrated)).toEqual({
      actions: [
        {
          id: 'test',
          name: 'Test',
          command: 'pnpm test --run',
          icon: 'test',
          runOnWorktreeCreate: false,
          shortcutRules: [{ shortcut: { key: 'T', mod: true }, order: 1 }],
        },
      ],
    })
  })

  it('persists multiple conditional bindings and appends edited rules to global precedence', async () => {
    await addProjectAction(projectPath, {
      name: 'Test',
      command: 'pnpm test',
      shortcutRules: [
        { shortcut: { key: 'R', mod: true }, when: 'terminalFocus' },
        { shortcut: { key: 'R', mod: true }, when: '!terminalFocus' },
      ],
    })
    await addProjectAction(projectPath, {
      name: 'Lint',
      command: 'pnpm lint',
      shortcutRules: [{ shortcut: { key: 'L', mod: true } }],
    })

    const updated = await updateProjectAction(projectPath, 'test', {
      shortcutRules: [
        { shortcut: { key: 'R', mod: true }, when: 'terminalFocus', order: 0 },
        { shortcut: { key: 'K', mod: true }, when: 'previewOpen' },
      ],
    })

    expect(updated).toEqual([
      expect.objectContaining({
        id: 'test',
        shortcutRules: [
          { shortcut: { key: 'R', mod: true }, when: 'terminalFocus', order: 0 },
          { shortcut: { key: 'K', mod: true }, when: 'previewOpen', order: 3 },
        ],
      }),
      expect.objectContaining({
        id: 'lint',
        shortcutRules: [{ shortcut: { key: 'L', mod: true }, order: 2 }],
      }),
    ])
  })

  it('keeps only the latest exact shortcut-condition pair', async () => {
    const actions = await addProjectAction(projectPath, {
      name: 'Test',
      command: 'pnpm test',
      shortcutRules: [
        { shortcut: { key: 'R', mod: true }, when: ' terminalFocus ' },
        { shortcut: { key: 'R', mod: true }, when: 'terminalFocus' },
      ],
    })

    expect(actions[0]?.shortcutRules).toEqual([
      { shortcut: { key: 'R', mod: true }, when: 'terminalFocus', order: 0 },
    ])
  })
})
