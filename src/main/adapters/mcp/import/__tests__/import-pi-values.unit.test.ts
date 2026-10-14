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
      // Named after the field; the import names it after the server it saves (DB_DB_PASSWORD).
      DB_PASSWORD: { secret: 'DB_PASSWORD' },
    })
  })

  it.each([
    ['claude-code', `Bearer \${GITHUB_TOKEN}`, `Bearer \${GITHUB_TOKEN}`],
    ['claude-code', `\${REGION:-eu}-$x`, `\${REGION}-$$x`],
    ['cursor', `Bearer \${env:GITHUB_TOKEN}`, `Bearer \${GITHUB_TOKEN}`],
    ['vscode', `Bearer \${env:GITHUB_TOKEN}`, `Bearer \${GITHUB_TOKEN}`],
    ['windsurf', `Bearer \${env:GITHUB_TOKEN}`, `Bearer \${GITHUB_TOKEN}`],
    ['opencode', 'Bearer {env:GITHUB_TOKEN}', `Bearer \${GITHUB_TOKEN}`],
    ['claude-desktop', `Bearer \${GITHUB_TOKEN}`, `Bearer $\${GITHUB_TOKEN}`],
    ['cursor', `Bearer \${GITHUB_TOKEN}`, `Bearer $\${GITHUB_TOKEN}`],
  ] as const)(
    `converts what %s interpolates (%s) to \${NAME} and escapes the rest`,
    (source, value, expected) => {
      expect(env(source, { AUTH: value })).toEqual({ AUTH: expected })
    },
  )

  it.each([
    ['cursor', `\${env:WORKSPACE}`],
    ['vscode', `\${input:workspace}`],
    ['opencode', '{env:WORKSPACE}'],
    ['claude-code', `\${WORKSPACE}`],
  ] as const)(
    'keeps a %s variable in args as written, since Pi does not expand args',
    (source, value) => {
      const normalized = normalizeImportedEntry(source, 'db', {
        command: 'db-mcp',
        args: ['--root', value],
        oauth: { clientId: value },
      })

      expect(normalized?.entry.args).toEqual(['--root', value])
      expect(normalized?.entry.oauth).toEqual({ clientId: value })
      expect(normalized?.warnings).toEqual([
        `args uses ${value}, which Pi does not expand there; it was kept as written.`,
        `oauth.clientId uses ${value}, which Pi does not expand there; it was kept as written.`,
      ])
    },
  )

  it('warns that a variable in the command, working directory, or URL is kept as written', () => {
    const normalized = normalizeImportedEntry('claude-code', 'db', {
      command: `\${HOME}/bin/db-mcp`,
      cwd: `\${PROJECT_ROOT}`,
    })
    const remote = normalizeImportedEntry('cursor', 'api', {
      url: `https://\${env:TENANT}.api.example/mcp`,
    })

    expect(normalized?.entry).toMatchObject({
      command: `\${HOME}/bin/db-mcp`,
      cwd: `\${PROJECT_ROOT}`,
    })
    expect(normalized?.warnings).toEqual([
      `command uses \${HOME}, which Pi does not expand there; it was kept as written.`,
      `cwd uses \${PROJECT_ROOT}, which Pi does not expand there; it was kept as written.`,
    ])
    expect(remote?.warnings).toEqual([
      `url uses \${env:TENANT}, which Pi does not expand there; it was kept as written.`,
    ])
  })

  it("warns about VS Code's own variables, which only VS Code fills in", () => {
    const normalized = normalizeImportedEntry('vscode', 'db', {
      command: 'db-mcp',
      args: ['--root', `\${workspaceFolder}`],
      env: { CACHE: `\${userHome}/.cache` },
    })

    expect(normalized?.entry.args).toEqual(['--root', `\${workspaceFolder}`])
    expect(normalized?.entry.env).toEqual({ CACHE: `$\${userHome}/.cache` })
    expect(normalized?.warnings).toEqual([
      "args uses VS Code's ${workspaceFolder}, which only VS Code fills in; Pi takes it as written, so put the real value there.",
      "env.CACHE uses VS Code's ${userHome}, which only VS Code fills in; Pi takes it as written, so put the real value there.",
    ])
  })
})
