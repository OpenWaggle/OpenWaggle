import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canonicalProject,
  harness,
  invoke,
  PROJECT_PATH,
  SENDER,
} from './workspace-files-handler.test-harness'

describe('workspace file entry, editor and watch handlers', () => {
  it('invalidates Git state after every entry mutation', async () => {
    await expect(
      invoke('workspace-files:create-entry', {
        projectPath: PROJECT_PATH,
        path: 'src/new.ts',
        kind: 'file',
      }),
    ).resolves.toEqual({ path: 'src/new.ts' })
    await expect(
      invoke('workspace-files:move-entry', {
        projectPath: PROJECT_PATH,
        path: 'src/new.ts',
        targetPath: 'src/moved.ts',
      }),
    ).resolves.toEqual({ path: 'src/moved.ts' })
    await expect(
      invoke('workspace-files:duplicate-entry', {
        projectPath: PROJECT_PATH,
        path: 'src/moved.ts',
        targetPath: 'src/copy.ts',
      }),
    ).resolves.toEqual({ path: 'src/copy.ts' })
    await expect(
      invoke('workspace-files:trash-entry', { projectPath: PROJECT_PATH, path: 'src/copy.ts' }),
    ).resolves.toEqual({ path: 'src/copy.ts' })

    expect(harness.invalidated).toEqual([
      canonicalProject,
      canonicalProject,
      canonicalProject,
      canonicalProject,
    ])
    expect(harness.calls.map(([method]) => method)).toEqual([
      'createEntry',
      'moveEntry',
      'duplicateEntry',
      'trashEntry',
    ])
  })

  it('opens a file in the chosen editor at its position', async () => {
    await invoke('workspace-files:open-external', {
      projectPath: PROJECT_PATH,
      path: 'src/example.ts',
      editor: 'vscode',
      line: 14,
      column: 3,
    })

    expect(harness.calls).toEqual([
      [
        'openFile',
        {
          projectPath: canonicalProject,
          path: 'src/example.ts',
          editor: 'vscode',
          line: 14,
          column: 3,
        },
      ],
    ])
  })

  it('opens a validated absolute file without requiring project authorization', async () => {
    const input = {
      path: '/Users/tester/.config/tool/settings.ts',
      editor: 'cursor',
      line: 8,
      column: 2,
    }

    await invoke('workspace-files:open-absolute-external', input)

    expect(harness.calls).toEqual([['openAbsoluteFile', input]])
  })

  it('watches and unwatches the canonical project for the calling window', async () => {
    await expect(invoke('workspace-files:watch', PROJECT_PATH)).resolves.toBe(canonicalProject)
    await invoke('workspace-files:unwatch', PROJECT_PATH)

    expect(harness.watched).toEqual([[canonicalProject, SENDER]])
    expect(harness.unwatched).toEqual([[canonicalProject, SENDER.id]])
  })

  it('searches an owner-approved root that is absent from the GUI database', async () => {
    const ownerRoot = await fs.realpath(path.dirname(PROJECT_PATH))
    harness.hostAuthorization = { handled: true, result: ownerRoot }

    await invoke('workspace-files:search', ownerRoot, 'src/main.ts', 10)

    expect(harness.calls).toEqual([
      ['searchFiles', { projectPath: ownerRoot, query: 'src/main.ts', limit: 10 }],
    ])
  })

  it('does not search a stale local root when the owner denies access', async () => {
    harness.hostDenies = true

    await expect(invoke('workspace-files:search', PROJECT_PATH, 'src/main.ts', 10)).rejects.toThrow(
      'Host denied access',
    )
    expect(harness.calls).toEqual([])
  })

  it.each([
    ['read', [path.dirname(PROJECT_PATH), 'outside.ts']],
    ['watch', [path.dirname(PROJECT_PATH)]],
    [
      'open-external',
      [{ projectPath: path.dirname(PROJECT_PATH), path: 'a.ts', editor: 'vscode' }],
    ],
  ])('refuses %s in an unregistered project root', async (channel, args) => {
    await expect(invoke(`workspace-files:${channel}`, ...args)).rejects.toThrow(
      'Project path is not authorized',
    )
    expect(harness.calls).toEqual([])
    expect(harness.watched).toEqual([])
  })
})
