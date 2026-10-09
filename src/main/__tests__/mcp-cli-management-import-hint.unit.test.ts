import type {
  McpImportCandidateView,
  McpImportPreviewView,
} from '@shared/types/mcp-configuration-operations'
import { describe, expect, it } from 'vitest'
import { run, view } from './mcp-cli-management.test-fixtures'

function changed(source: McpImportCandidateView['source'], name: string): McpImportCandidateView {
  return {
    source,
    sourcePath: `/home/.${source}/mcp.json`,
    suggestedTarget: 'global',
    name,
    targetName: name,
    target: `npx ${name}`,
    fingerprint: `fp-${source}-${name}`,
    warnings: [],
    status: 'source-changed',
  }
}

const CANDIDATES = [
  changed('cursor', 'github'),
  changed('cursor', 'my server'),
  changed('vscode', 'github'),
]

function previewOf(sources: readonly string[] | undefined): McpImportPreviewView {
  return {
    candidates: CANDIDATES.filter((candidate) => !sources || sources.includes(candidate.source)),
    unavailableSources: [],
    errors: [],
  }
}

/** Splits a printed command as a POSIX shell would, for the quoting the hint uses. */
function shellWords(command: string) {
  const words: string[] = []
  for (const match of command.matchAll(/'((?:[^']|'\\\\'')*)'|(\S+)/g)) {
    words.push(match[1] === undefined ? (match[2] ?? '') : match[1].replaceAll("'\\\\''", "'"))
  }
  return words
}

describe("openwaggle mcp import's hint for servers that changed in their app", () => {
  it('prints one command per app that, run as printed, updates exactly those servers', async () => {
    const skipping = await run('import', ['--apply'], {
      'mcp:preview-imports': (input) => previewOf(input.sources),
      'mcp:apply-imports': (input) => ({
        imported: [],
        skipped: input.fingerprints.map((fingerprint) => ({ fingerprint, reason: 'exists' })),
        secrets: [],
        existingSecrets: [],
        view: view([]),
      }),
    })
    const commands = skipping.logs
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('openwaggle mcp import'))

    expect(commands).toEqual([
      "openwaggle mcp import --from cursor --apply --conflict replace --server github --server 'my server'",
      'openwaggle mcp import --from vscode --apply --conflict replace --server github',
    ])
    const updated: unknown[] = []
    for (const command of commands) {
      const [, , command_, ...args] = shellWords(command)
      expect(command_).toBe('import')
      await run('import', args, {
        'mcp:preview-imports': (input) => previewOf(input.sources),
        'mcp:apply-imports': (input) => {
          updated.push([input.sources, input.conflictPolicy, input.fingerprints])
          return { imported: [], skipped: [], secrets: [], existingSecrets: [], view: view([]) }
        },
      })
    }
    expect(updated).toEqual([
      [['cursor'], 'replace', ['fp-cursor-github', 'fp-cursor-my server']],
      [['vscode'], 'replace', ['fp-vscode-github']],
    ])
  })
})
