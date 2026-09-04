import { describe, expect, it, vi } from 'vitest'
import { discoverWorkspaceExternalEditors } from '../workspace-external-editor'
import { workspaceExternalEditorLaunchArguments } from '../workspace-external-editor-launcher'

describe('workspace external editor discovery', () => {
  it('returns installed command-line editors in the curated order', async () => {
    const commandAvailable = vi.fn(
      async (command: string) => command === 'code' || command === 'zed',
    )

    const editors = await discoverWorkspaceExternalEditors({
      platform: 'linux',
      homeDirectory: '/home/tester',
      commandAvailable,
    })

    expect(editors).toEqual([
      { id: 'vscode', label: 'Visual Studio Code' },
      { id: 'zed', label: 'Zed' },
    ])
    expect(commandAvailable).toHaveBeenCalledWith('code')
    expect(commandAvailable).toHaveBeenCalledWith('zeditor')
  })

  it('finds macOS app bundles when their CLI is not on PATH', async () => {
    const pathAvailable = vi.fn(
      async (candidatePath: string) => candidatePath === '/Applications/Zed.app',
    )

    const editors = await discoverWorkspaceExternalEditors({
      platform: 'darwin',
      homeDirectory: '/Users/tester',
      commandAvailable: async () => false,
      pathAvailable,
    })

    expect(editors).toEqual([{ id: 'zed', label: 'Zed' }])
    expect(pathAvailable).toHaveBeenCalledWith('/Applications/Zed.app')
  })
})

describe('workspace external editor launch arguments', () => {
  it('uses VS Code-style goto arguments without splitting the file path', () => {
    expect(
      workspaceExternalEditorLaunchArguments(
        'vscode',
        '/Users/tester/Project Folder/src/example.ts',
        27,
      ),
    ).toEqual(['--goto', '/Users/tester/Project Folder/src/example.ts:27'])
  })

  it('uses direct paths for editors without a portable line flag', () => {
    expect(workspaceExternalEditorLaunchArguments('zed', '/tmp/example.ts', 9)).toEqual([
      '/tmp/example.ts',
    ])
  })

  it('uses JetBrains line arguments when a line is available', () => {
    expect(workspaceExternalEditorLaunchArguments('idea', '/tmp/example.ts', 9)).toEqual([
      '--line',
      '9',
      '/tmp/example.ts',
    ])
  })
})
