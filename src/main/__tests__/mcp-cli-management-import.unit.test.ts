import type { McpImportPreviewView } from '@shared/types/mcp-configuration-operations'
import { describe, expect, it } from 'vitest'
import { CWD, run, view } from './mcp-cli-management.test-fixtures'

describe('openwaggle mcp import', () => {
  const preview: McpImportPreviewView = {
    candidates: [
      {
        source: 'cursor',
        sourcePath: '/home/.cursor/mcp.json',
        suggestedTarget: 'global',
        name: 'linear',
        targetName: 'linear',
        target: 'https://mcp.linear.app/mcp',
        fingerprint: 'fp-linear',
        warnings: [],
        status: 'new',
      },
      {
        source: 'codex',
        sourcePath: '/home/.codex/config.toml',
        suggestedTarget: 'global',
        name: 'files',
        targetName: 'files',
        target: 'npx files-mcp',
        fingerprint: 'fp-files',
        warnings: [],
        status: 'imported',
      },
    ],
    unavailableSources: [],
    errors: [],
  }

  it('previews without writing', async () => {
    const result = await run('import', ['--from', 'cursor,codex'], {
      'mcp:preview-imports': () => preview,
    })

    expect(result.calls).toEqual([
      {
        channel: 'mcp:preview-imports',
        input: { projectPath: null, sources: ['cursor', 'codex'] },
      },
    ])
    expect(result.logs).toContain('cursor: linear (https://mcp.linear.app/mcp) new')
  })

  it('applies only new servers unless --server names them', async () => {
    const result = await run('import', ['--apply', '-l', '--conflict', 'rename'], {
      'mcp:preview-imports': () => preview,
      'mcp:apply-imports': () => ({
        imported: [
          { source: 'cursor', sourceName: 'linear', targetName: 'linear', fingerprint: 'fp' },
        ],
        skipped: [],
        view: view([]),
      }),
    })

    expect(result.calls[1]?.input).toEqual({
      projectPath: CWD,
      fingerprints: ['fp-linear'],
      target: 'project',
      conflictPolicy: 'rename',
    })
    expect(result.logs).toBe('Imported cursor server "linear" as "linear".')
  })

  it('rejects an unknown tool and an unknown server name', async () => {
    const tool = await run('import', ['--from', 'pi'], {})
    const name = await run('import', ['--apply', '--server', 'nope'], {
      'mcp:preview-imports': () => preview,
    })

    expect(tool.exitCode).toBe(2)
    expect(tool.errors).toContain('Unknown import source "pi"')
    expect(name.exitCode).toBe(1)
    expect(name.errors).toContain('No server named "nope"')
  })
})
