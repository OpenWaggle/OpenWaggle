import { describe, expect, it } from 'vitest'
import { normalizeImportedEntry } from '../import-normalization'
import type { ExternalMcpImportSource } from '../import-types'

/**
 * The other ways a credential is written on a command line (R3's import probes): attached and
 * `=` forms of the env and header flags, curl's `-H`, and mcp-remote headers that already read a
 * variable, whose variable then holds the credential.
 */

function imported(
  server: Record<string, unknown>,
  source: ExternalMcpImportSource = 'claude-desktop',
) {
  const result = normalizeImportedEntry(source, 'svc', server)
  if (!result) throw new Error('The entry was not normalized.')
  return result
}

function expectNoValue(result: ReturnType<typeof imported>, ...values: readonly string[]) {
  const text = JSON.stringify(result)
  for (const value of values) expect(text).not.toContain(value)
}

describe('credentials in other command-line forms', () => {
  it.each([
    [
      ['run', '-i', '--env=GITHUB_TOKEN=ghp_secret1', 'img'],
      ['run', '-i', '--env=GITHUB_TOKEN', 'img'],
    ],
    [
      ['run', '-eGITHUB_TOKEN=ghp_secret1', 'img'],
      ['run', '-eGITHUB_TOKEN', 'img'],
    ],
  ])('passes Docker %j through a vault secret', (args, expected) => {
    const result = imported({ command: 'docker', args })

    expect(result.entry).toMatchObject({
      args: expected,
      env: { GITHUB_TOKEN: { secret: 'GITHUB_TOKEN' } },
    })
    expect(result.warnings.join('\n')).toContain('GITHUB_TOKEN')
    expectNoValue(result, 'ghp_secret1')
  })

  it('keeps a Docker variable the source tool fills in, as an env reference', () => {
    const result = imported(
      { command: 'docker', args: ['run', '-e', 'GITHUB_TOKEN=${GH}', 'img'] },
      'claude-code',
    )

    expect(result.entry).toMatchObject({
      args: ['run', '-e', 'GITHUB_TOKEN', 'img'],
      env: { GITHUB_TOKEN: '${GH}' },
    })
  })

  it.each([
    ['--header=', ['-y', 'supergateway', '--header=Authorization: Bearer sk-h1']],
    ['-H', ['-y', 'srv', '-H', 'Authorization: Bearer sk-h1']],
    ['-H attached', ['-y', 'srv', '-HAuthorization: Bearer sk-h1']],
  ])('drops a credential header written with %s', (_, args) => {
    const result = imported({ command: 'npx', args })

    expect(result.entry.args).toEqual(args.slice(0, 2))
    expect(result.warnings).toHaveLength(1)
    expectNoValue(result, 'sk-h1')
  })

  it('rewrites a plaintext mcp-remote header for a versioned mcp-remote too (h2)', () => {
    const result = imported({
      command: 'npx',
      args: ['-y', 'mcp-remote@latest', 'https://x/mcp', '--header', 'Authorization: Bearer sk-h2'],
    })

    expect(result.entry).toMatchObject({
      args: [
        '-y',
        'mcp-remote@latest',
        'https://x/mcp',
        '--header',
        'Authorization:${AUTHORIZATION}',
      ],
      env: { AUTHORIZATION: { secret: 'AUTHORIZATION' } },
    })
    expect(result.warnings.join('\n')).toContain('AUTHORIZATION')
    expectNoValue(result, 'sk-h2')
  })

  it.each([
    ['r', 'Authorization: Bearer ${AUTH_TOKEN}', 'AUTH_TOKEN', 'tok'],
    ['r2', 'Authorization:${AUTH_HEADER}', 'AUTH_HEADER', 'Bearer sk-live'],
  ])(
    'keeps an mcp-remote header that reads a variable, and vaults the variable (%s)',
    (_, header, variable, value) => {
      const args = ['mcp-remote', 'https://x/mcp', '--header', header]
      const result = imported({ command: 'npx', args, env: { [variable]: value } })

      expect(result.entry).toMatchObject({
        args,
        env: { [variable]: { secret: variable } },
      })
      expect(result.warnings.join('\n')).toContain(`env.${variable}`)
      expectNoValue(result, value)
    },
  )
})
