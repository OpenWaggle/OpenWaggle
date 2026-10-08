import { describe, expect, it } from 'vitest'
import { normalizeImportedEntry } from '../import-normalization'
import type { ExternalMcpImportSource } from '../import-types'

function env(source: ExternalMcpImportSource, values: Record<string, string>) {
  const entry = normalizeImportedEntry(source, 'db', { command: 'db-mcp', env: values })?.entry
  return entry?.env
}

describe('imported env and header values, as Pi will read them', () => {
  it.each(['claude-desktop', 'codex', 'zed', 'cursor', 'vscode', 'windsurf', 'opencode'] as const)(
    'never runs a leading ! from %s and keeps its $ literal',
    (source) => {
      expect(env(source, { MODE: '!rm -rf ~', NOTE: '$HOME/x' })).toEqual({
        MODE: '$!rm -rf ~',
        NOTE: '$$HOME/x',
      })
    },
  )

  it('withholds a credential that starts with ! instead of keeping it as a command', () => {
    expect(env('claude-desktop', { DB_PASSWORD: '!Sup3r$ecret' })).toEqual({
      DB_PASSWORD: { secret: 'DB_DB_PASSWORD' },
    })
  })

  it.each([
    ['claude-code', `Bearer \${GITHUB_TOKEN}`, `Bearer \${GITHUB_TOKEN}`],
    ['claude-code', `\${REGION:-eu}-$x`, `\${REGION}-$$x`],
    ['cursor', `Bearer \${env:GITHUB_TOKEN}`, `Bearer \${GITHUB_TOKEN}`],
    ['vscode', `Bearer \${env:GITHUB_TOKEN}`, `Bearer \${GITHUB_TOKEN}`],
    ['windsurf', `Bearer \${env:GITHUB_TOKEN}`, `Bearer \${GITHUB_TOKEN}`],
    ['opencode', 'Bearer {env:GITHUB_TOKEN}', `Bearer \${GITHUB_TOKEN}`],
    ['claude-desktop', `Bearer \${GITHUB_TOKEN}`, 'Bearer $${GITHUB_TOKEN}'],
    ['cursor', `Bearer \${GITHUB_TOKEN}`, 'Bearer $${GITHUB_TOKEN}'],
  ] as const)(
    `converts what %s interpolates (%s) to \${NAME} and escapes the rest`,
    (source, value, expected) => {
      expect(env(source, { AUTH: value })).toEqual({ AUTH: expected })
    },
  )
})
