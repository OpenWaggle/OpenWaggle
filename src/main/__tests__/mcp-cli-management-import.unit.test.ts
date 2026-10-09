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

  it.each([
    [
      ['--from', 'cursor,codex'],
      'openwaggle mcp import --from cursor,codex --apply [--server <name>]',
    ],
    [['-l'], 'openwaggle mcp import -l --apply [--server <name>]'],
    [
      ['--project', 'repo', '--from', 'cursor'],
      'openwaggle mcp import --project /resolved/repo --from cursor --apply [--server <name>]',
    ],
  ])('keeps %j in the apply hint it prints', async (args, hint) => {
    const result = await run('import', args, { 'mcp:preview-imports': () => preview })

    expect(result.logs).toContain(`Import them with: ${hint}`)
  })

  it('applies only new servers unless --server names them', async () => {
    const result = await run('import', ['--apply', '-l', '--conflict', 'rename'], {
      'mcp:preview-imports': () => preview,
      'mcp:apply-imports': () => ({
        imported: [
          {
            source: 'cursor',
            sourceName: 'linear',
            targetName: 'linear',
            fingerprint: 'fp',
            secrets: [],
          },
        ],
        skipped: [],
        secrets: [],
        existingSecrets: [],
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

  it('names the vault secrets the imported servers read, and those that already exist', async () => {
    const result = await run('import', ['--apply'], {
      'mcp:preview-imports': () => preview,
      'mcp:apply-imports': () => ({
        imported: [
          {
            source: 'cursor',
            sourceName: 'github',
            targetName: 'github-2',
            fingerprint: 'fp',
            secrets: ['GITHUB_2_AUTHORIZATION', 'GITHUB_2_TOKEN'],
          },
        ],
        skipped: [],
        secrets: ['GITHUB_2_AUTHORIZATION', 'GITHUB_2_TOKEN'],
        existingSecrets: ['GITHUB_2_TOKEN'],
        view: view([]),
      }),
    })

    expect(result.logs.split('\n')).toEqual([
      'Imported cursor server "github" as "github-2".',
      'It reads the vault secret GITHUB_2_AUTHORIZATION. Add it in Settings > MCP > Secrets before using it.',
      'It uses the vault secret GITHUB_2_TOKEN, which already exists; replace it in Settings > MCP > Secrets if it holds another value.',
    ])
  })
})
