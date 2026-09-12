import { describe, expect, it, vi } from 'vitest'
import { discoverWorkspaceExternalEditors } from '../workspace-external-editor'
import {
  workspaceExternalEditorLaunchArguments,
  workspaceExternalEditorMacApplicationLaunchArguments,
} from '../workspace-external-editor-launcher'

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
  it('uses VS Code-style goto arguments without splitting the positioned file path', () => {
    expect(
      workspaceExternalEditorLaunchArguments(
        'vscode',
        '/Users/tester/Project Folder/src/example.ts',
        27,
        4,
      ),
    ).toEqual(['--goto', '/Users/tester/Project Folder/src/example.ts:27:4'])
  })

  it('keeps positions on direct targets', () => {
    expect(workspaceExternalEditorLaunchArguments('zed', '/tmp/example.ts', 9, 2)).toEqual([
      '/tmp/example.ts:9:2',
    ])
  })

  it('uses JetBrains line and column arguments when a position is available', () => {
    expect(workspaceExternalEditorLaunchArguments('idea', '/tmp/example.ts', 9, 3)).toEqual([
      '--line',
      '9',
      '--column',
      '3',
      '/tmp/example.ts',
    ])
  })

  it('prepends editor-specific base arguments', () => {
    expect(workspaceExternalEditorLaunchArguments('kiro', '/tmp/example.ts', 9, 3)).toEqual([
      'ide',
      '--goto',
      '/tmp/example.ts:9:3',
    ])
  })

  it('preserves file positions through a macOS app-bundle fallback', () => {
    expect(
      workspaceExternalEditorMacApplicationLaunchArguments(
        'Visual Studio Code',
        'vscode',
        '/Users/tester/Project Folder/src/example.ts',
        27,
        4,
      ),
    ).toEqual([
      '-a',
      'Visual Studio Code',
      '--args',
      '--goto',
      '/Users/tester/Project Folder/src/example.ts:27:4',
    ])
  })

  it('uses the native macOS file-open path when there is no position', () => {
    expect(
      workspaceExternalEditorMacApplicationLaunchArguments(
        'Visual Studio Code',
        'vscode',
        '/Users/tester/example.ts',
      ),
    ).toEqual(['-a', 'Visual Studio Code', '/Users/tester/example.ts'])
  })
})
