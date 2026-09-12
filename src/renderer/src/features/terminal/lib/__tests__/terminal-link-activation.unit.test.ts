import { describe, expect, it, vi } from 'vitest'
import { activateTerminalLinkTarget } from '../terminal-link-activation'

describe('terminal link activation', () => {
  it('preserves an external file position for the preferred-editor route', async () => {
    const openExternalFile = vi.fn(async () => undefined)

    await activateTerminalLinkTarget(
      {
        kind: 'file',
        source: 'plain',
        rawPath: '~/.config/tool/settings.ts:12:4',
        resolvedPath: '/Users/tester/.config/tool/settings.ts',
        line: 12,
        column: 4,
        projectRelativePath: null,
        route: 'external-editor',
        resolution: 'home-relative',
      },
      {
        openUrl: vi.fn(),
        openExternalFile,
        openWorkspaceFile: vi.fn(),
      },
    )

    expect(openExternalFile).toHaveBeenCalledExactlyOnceWith(
      '/Users/tester/.config/tool/settings.ts',
      12,
      4,
    )
  })

  it('keeps project files in the confined preview route', () => {
    const openWorkspaceFile = vi.fn()

    activateTerminalLinkTarget(
      {
        kind: 'file',
        source: 'plain',
        rawPath: 'src/main.ts:8:2',
        resolvedPath: '/repo/src/main.ts',
        line: 8,
        column: 2,
        projectRelativePath: 'src/main.ts',
        route: 'workspace-preview',
        resolution: 'cwd-relative',
      },
      {
        openUrl: vi.fn(),
        openExternalFile: vi.fn(),
        openWorkspaceFile,
      },
    )

    expect(openWorkspaceFile).toHaveBeenCalledExactlyOnceWith('src/main.ts', 8)
  })
})
