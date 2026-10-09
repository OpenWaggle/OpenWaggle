import { describe, expect, it } from 'vitest'
import { normalizeImportedEntry } from '../import-normalization'
import type { ExternalMcpImportSource } from '../import-types'

/**
 * Credentials written into another tool's server entry in the forms people use: they never reach
 * OpenWaggle's file, become vault references where the server can read one, and warnings never
 * repeat their value.
 */

function imported(server: Record<string, unknown>, source: ExternalMcpImportSource = 'cursor') {
  const result = normalizeImportedEntry(source, 'svc', server)
  if (!result) throw new Error('The entry was not normalized.')
  return result
}

function expectNoValue(result: ReturnType<typeof imported>, ...values: readonly string[]) {
  const text = JSON.stringify(result)
  for (const value of values) expect(text).not.toContain(value)
}

describe('credentials in an imported server entry', () => {
  it('keeps flags that only contain a credential word, and their values', () => {
    const result = imported({
      command: 'llm',
      args: ['--max-tokens', '4096', '--credentials-file', '/etc/llm.json', '--token-limit=5'],
    })

    expect(result.entry.args).toEqual([
      '--max-tokens',
      '4096',
      '--credentials-file',
      '/etc/llm.json',
      '--token-limit=5',
    ])
    expect(result.warnings).toEqual([])
  })

  it('drops a credential flag together with its value', () => {
    const result = imported({
      command: 'api-mcp',
      args: [
        '--api-key',
        'sk-one',
        '--client-secret=sk-two',
        '--verbose',
        '--password',
        'pw-three',
      ],
    })

    expect(result.entry.args).toEqual(['--verbose'])
    expect(result.warnings).toHaveLength(3)
    expectNoValue(result, 'sk-one', 'sk-two', 'pw-three')
  })

  it('treats a value only the source tool would have expanded as a credential in Codex', () => {
    const codex = imported({ command: 'api-mcp', args: ['--api-key', '!pass show api'] }, 'codex')
    const literal = imported({ command: 'api-mcp', args: ['--api-key', '${API_KEY}'] }, 'codex')

    expect(codex.entry.args).toBeUndefined()
    expect(literal.entry.args).toBeUndefined()
    expectNoValue(codex, 'pass show api')
  })

  it('passes a Docker -e credential through a vault secret', () => {
    const result = imported({
      command: 'docker',
      args: [
        'run',
        '-i',
        '-e',
        'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_plaintext',
        '-e',
        'LOG_LEVEL=debug',
        'ghcr.io/github/github-mcp-server',
      ],
    })

    expect(result.entry).toMatchObject({
      args: [
        'run',
        '-i',
        '-e',
        'GITHUB_PERSONAL_ACCESS_TOKEN',
        '-e',
        'LOG_LEVEL=debug',
        'ghcr.io/github/github-mcp-server',
      ],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: { secret: 'GITHUB_PERSONAL_ACCESS_TOKEN' } },
    })
    expectNoValue(result, 'ghp_plaintext')
  })

  it('passes an mcp-remote --header credential through a vault secret', () => {
    const result = imported({
      command: 'npx',
      args: [
        '-y',
        'mcp-remote',
        'https://mcp.example/sse',
        '--header',
        'Authorization: Bearer abc123',
      ],
    })

    expect(result.entry).toMatchObject({
      args: [
        '-y',
        'mcp-remote',
        'https://mcp.example/sse',
        '--header',
        // The scheme stays, so the secret holds only the token; mcp-remote fills in ${NAME}.
        'Authorization:Bearer ${AUTHORIZATION}',
      ],
      env: { AUTHORIZATION: { secret: 'AUTHORIZATION' } },
    })
    expect(result.warnings.join('\n')).toContain('holds only the token')
    expectNoValue(result, 'abc123')
  })

  it('drops a --header credential for a command that would not read a variable', () => {
    const result = imported({ command: 'tool', args: ['--header', 'X-Api-Key: k-plain', '--x'] })

    expect(result.entry.args).toEqual(['--x'])
    expectNoValue(result, 'k-plain')
  })

  it('removes a credential from a URL query or its userinfo', () => {
    const result = imported({
      url: 'https://user:pw-secret@mcp.example/mcp?api_key=q-secret&region=eu',
    })
    const argument = imported({
      command: 'npx',
      args: ['mcp-remote', 'https://mcp.example/sse?token=t-secret'],
    })

    expect(result.entry.url).toBe('https://mcp.example/mcp?region=eu')
    expect(argument.entry.args).toEqual(['mcp-remote', 'https://mcp.example/sse'])
    expect(result.warnings.length).toBeGreaterThan(0)
    expectNoValue(result, 'pw-secret', 'q-secret')
    expectNoValue(argument, 't-secret')
  })

  it('treats KEY names as credentials, but not tokens limits', () => {
    const result = imported({
      command: 'x',
      env: { OPENAI_KEY: 'sk-a', DD_APP_KEY: 'dd-b', MAX_TOKENS: '4096', KEY_FILE: '/k' },
    })

    expect(result.entry.env).toEqual({
      OPENAI_KEY: { secret: 'OPENAI_KEY' },
      DD_APP_KEY: { secret: 'DD_APP_KEY' },
      MAX_TOKENS: '4096',
      KEY_FILE: '/k',
    })
    expectNoValue(result, 'sk-a', 'dd-b')
  })
})
