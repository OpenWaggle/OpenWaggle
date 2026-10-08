import { describe, expect, it } from 'vitest'
import { applyMcpImports, type McpImportWrite } from '../import-apply'
import { previewMcpImports } from '../import-preview'

const HOME = '/home/user'
const CURSOR = `${HOME}/.cursor/mcp.json`
const NOW = new Date('2026-10-01T12:00:00.000Z')

function cursorPreview(servers: Record<string, unknown>, targetServers?: Record<string, unknown>) {
  const text = JSON.stringify({ mcpServers: servers })
  return previewMcpImports({
    homeDir: HOME,
    platform: 'linux',
    sources: ['cursor'],
    readText: (filePath) => Promise.resolve(filePath === CURSOR ? text : undefined),
    ...(targetServers ? { targetServers: { global: targetServers } } : {}),
  })
}

function recordingWriter() {
  const calls: { target: string; writes: readonly McpImportWrite[] }[] = []
  return {
    calls,
    write: (target: 'global' | 'project', writes: readonly McpImportWrite[]) => {
      calls.push({ target, writes })
      return Promise.resolve()
    },
  }
}

describe('applying MCP imports through the config writer', () => {
  it('treats a name from another MCP file, or a - / _ variant of it, as taken', async () => {
    const preview = await cursorPreview({ dev_radius: { command: 'dr' } })
    const fingerprints = preview.candidates.map((candidate) => candidate.fingerprint)
    const apply = (conflictPolicy: 'skip' | 'rename' | 'replace') => {
      const writer = recordingWriter()
      return applyMcpImports({
        preview,
        fingerprints,
        target: 'global',
        targetServers: {},
        otherServerNames: ['dev-radius'],
        conflictPolicy,
        now: () => NOW,
        write: writer.write,
      }).then(() =>
        writer.calls.flatMap((call) => call.writes.map((write) => [write.name, write.replace])),
      )
    }

    expect(await apply('skip')).toEqual([])
    expect(await apply('rename')).toEqual([['dev_radius-2', false]])
    expect(await apply('replace')).toEqual([['dev-radius', true]])
  })

  it('writes selected candidates as Pi entries with provenance, and nothing else', async () => {
    const preview = await cursorPreview({
      files: { command: 'files-mcp' },
      other: { command: 'x' },
    })
    const files = preview.candidates.find((candidate) => candidate.name === 'files')
    const writer = recordingWriter()

    const result = await applyMcpImports({
      preview,
      fingerprints: [files?.fingerprint ?? ''],
      target: 'global',
      targetServers: {},
      conflictPolicy: 'skip',
      now: () => NOW,
      write: writer.write,
    })

    expect(writer.calls).toEqual([
      {
        target: 'global',
        writes: [
          {
            name: 'files',
            replace: false,
            entry: {
              command: 'files-mcp',
              provenance: {
                source: 'cursor',
                sourcePath: CURSOR,
                sourceName: 'files',
                fingerprint: files?.fingerprint,
                importedAt: NOW.toISOString(),
              },
            },
          },
        ],
      },
    ])
    expect(result.imported).toEqual([
      {
        source: 'cursor',
        sourceName: 'files',
        targetName: 'files',
        fingerprint: files?.fingerprint,
        secrets: [],
      },
    ])
  })

  it('skips, replaces, or renames on a name conflict, treating - and _ as the same', async () => {
    const preview = await cursorPreview({ 'my-server': { command: 'mine' } })
    const fingerprints = preview.candidates.map((candidate) => candidate.fingerprint)
    const targetServers = { my_server: { command: 'existing' }, 'my-server-2': { command: 'x' } }

    const outcomes = await Promise.all(
      (['skip', 'replace', 'rename'] as const).map(async (conflictPolicy) => {
        const writer = recordingWriter()
        const result = await applyMcpImports({
          preview,
          fingerprints,
          target: 'global',
          targetServers,
          conflictPolicy,
          now: () => NOW,
          write: writer.write,
        })
        return { result, writes: writer.calls.flatMap((call) => call.writes) }
      }),
    )

    expect(outcomes[0]?.writes).toEqual([])
    expect(outcomes[0]?.result.skipped).toEqual([
      {
        fingerprint: fingerprints[0],
        reason: 'A server named my-server already exists in the target configuration.',
      },
    ])
    expect(outcomes[1]?.writes.map(({ name, replace }) => ({ name, replace }))).toEqual([
      { name: 'my_server', replace: true },
    ])
    expect(outcomes[2]?.writes.map(({ name, replace }) => ({ name, replace }))).toEqual([
      { name: 'my-server-3', replace: false },
    ])
  })

  it('reports stale fingerprints and servers without a portable endpoint', async () => {
    const preview = await cursorPreview({ broken: { args: ['only-args'] } })
    const writer = recordingWriter()

    const result = await applyMcpImports({
      preview,
      fingerprints: ['stale', preview.candidates[0]?.fingerprint ?? ''],
      target: 'project',
      targetServers: {},
      conflictPolicy: 'skip',
      now: () => NOW,
      write: writer.write,
    })

    expect(writer.calls).toEqual([])
    expect(result.skipped).toEqual([
      {
        fingerprint: 'stale',
        reason: 'The source changed or disappeared after preview. Preview imports again.',
      },
      {
        fingerprint: preview.candidates[0]?.fingerprint,
        reason: 'No portable command or URL was found; this server cannot be imported.',
      },
    ])
  })

  it('recognises an earlier import of the same server in the preview', async () => {
    const first = await cursorPreview({ files: { command: 'files-mcp' } })
    const writer = recordingWriter()
    await applyMcpImports({
      preview: first,
      fingerprints: first.candidates.map((candidate) => candidate.fingerprint),
      target: 'global',
      targetServers: {},
      conflictPolicy: 'skip',
      now: () => NOW,
      write: writer.write,
    })
    const written = Object.fromEntries(
      writer.calls.flatMap((call) => call.writes).map((write) => [write.name, write.entry]),
    )

    const unchanged = await cursorPreview({ files: { command: 'files-mcp' } }, written)
    const changed = await cursorPreview({ files: { command: 'files-mcp', args: ['-v'] } }, written)

    expect(unchanged.candidates[0]?.status).toBe('imported')
    expect(changed.candidates[0]?.status).toBe('source-changed')
  })

  it("names a renamed import's vault secrets after the name it is saved as", async () => {
    const github = (url: string) => ({
      url,
      headers: { Authorization: 'Bearer ghp_plaintext' },
    })
    const windsurf = `${HOME}/.codeium/windsurf/mcp_config.json`
    const texts: Record<string, string> = {
      [CURSOR]: JSON.stringify({
        mcpServers: { github: github('https://api.github.example/mcp') },
      }),
      [windsurf]: JSON.stringify({ mcpServers: { github: github('https://evil.example/mcp') } }),
    }
    const preview = await previewMcpImports({
      homeDir: HOME,
      platform: 'linux',
      sources: ['cursor', 'windsurf'],
      readText: (filePath) => Promise.resolve(texts[filePath]),
    })
    const writer = recordingWriter()

    const result = await applyMcpImports({
      preview,
      fingerprints: preview.candidates.map((candidate) => candidate.fingerprint),
      target: 'global',
      // A server the user already has reads GITHUB_AUTHORIZATION.
      targetServers: {
        github: {
          url: 'https://github.example',
          headers: { Authorization: { secret: 'GITHUB_AUTHORIZATION' } },
        },
      },
      conflictPolicy: 'rename',
      now: () => NOW,
      write: writer.write,
    })

    const writes = writer.calls.flatMap((call) => call.writes)
    expect(writes.map((write) => [write.name, write.entry.headers])).toEqual([
      ['github-2', { Authorization: { secret: 'GITHUB_2_AUTHORIZATION' } }],
      ['github-3', { Authorization: { secret: 'GITHUB_3_AUTHORIZATION' } }],
    ])
    expect(result.imported.map((item) => [item.targetName, item.secrets])).toEqual([
      ['github-2', ['GITHUB_2_AUTHORIZATION']],
      ['github-3', ['GITHUB_3_AUTHORIZATION']],
    ])
    expect(JSON.stringify({ preview, writes })).not.toContain('ghp_plaintext')
  })
})
