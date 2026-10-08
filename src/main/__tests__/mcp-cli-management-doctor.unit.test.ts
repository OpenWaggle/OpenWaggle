import { describe, expect, it } from 'vitest'
import { run, server, view } from './mcp-cli-management.test-fixtures'

describe('openwaggle mcp doctor', () => {
  it('reports the files, the errors Pi found, and each server with its stderr tail', async () => {
    const result = await run('doctor', [], {
      'mcp:get-configuration': () =>
        view(
          [
            server({ name: 'files' }),
            server({ name: 'broken' }),
            server({ name: 'off', enabled: false }),
          ],
          ['/home/.pi/agent/mcp.json: server "bad": url must be a string'],
        ),
      'mcp:inspect-server': ({ name }) =>
        name === 'broken'
          ? {
              name,
              state: 'failed',
              tools: [],
              error: 'Connection closed',
              stderrTail: 'Error: Cannot find module\n  at node:internal',
            }
          : {
              name,
              state: 'connected',
              tools: [{ name: 'read', exposure: 'codemode', hasApp: false }],
            },
    })

    expect(result.exitCode).toBe(1)
    expect(result.calls.map((call) => call.input)).toEqual([
      { projectPath: null },
      { projectPath: null, name: 'files' },
      { projectPath: null, name: 'broken' },
    ])
    expect(result.logs).toBe(
      [
        'Files (lowest priority first):',
        '  found    /home/.openwaggle/mcp.json (openwaggle-global)',
        '  missing  /work/project/.openwaggle/mcp.json (project-openwaggle)',
        '  Project files are checked with -l or --project <path>.',
        'Configuration errors:',
        '  /home/.pi/agent/mcp.json: server "bad": url must be a string',
        'Servers:',
        '  files: connected, 1 tool (global, /home/.openwaggle/mcp.json)',
        '  broken: failed (global, /home/.openwaggle/mcp.json)',
        '    Connection closed',
        '    stderr:',
        '      Error: Cannot find module',
        '        at node:internal',
        '  off: disabled (global, /home/.openwaggle/mcp.json)',
        'Some MCP servers need attention.',
      ].join('\n'),
    )
  })

  it('prints a JSON report and succeeds when every enabled server connects', async () => {
    const result = await run('doctor', ['--json', '-l'], {
      'mcp:get-configuration': () => view([server({ name: 'files' })]),
      'mcp:inspect-server': ({ name }) => ({ name, state: 'connected', tools: [] }),
    })

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.logs)
    expect(report).toMatchObject({
      ok: true,
      errors: [],
      servers: [{ name: 'files', state: 'connected', tools: 0, enabled: true }],
    })
    expect(report.files).toHaveLength(2)
    expect(result.calls[0]?.input).toEqual({ projectPath: '/work/project' })
  })

  it('reports a server whose check fails outright and still checks the others', async () => {
    const result = await run('doctor', [], {
      'mcp:get-configuration': () => view([server({ name: 'vaulted' }), server({ name: 'files' })]),
      'mcp:inspect-server': ({ name }) => {
        if (name === 'vaulted') throw new Error('vault secret "GONE" could not be read')
        return { name, state: 'connected', tools: [] }
      },
    })

    expect(result.exitCode).toBe(1)
    expect(result.logs).toContain('  vaulted: failed (global, /home/.openwaggle/mcp.json)')
    expect(result.logs).toContain('    vault secret "GONE" could not be read')
    expect(result.logs).toContain('  files: connected, 0 tools')
  })

  it('takes no positional arguments', async () => {
    const result = await run('doctor', ['files'], {})

    expect(result.exitCode).toBe(2)
    expect(result.errors).toContain('Usage: openwaggle mcp doctor')
  })

  it.each([
    [[], 'openwaggle mcp login sentry'],
    [['-l'], 'openwaggle mcp login sentry -l'],
    [['--project', 'repo'], 'openwaggle mcp login sentry --project /resolved/repo'],
  ])('gives a sign-in command for the same project (%j)', async (args, command) => {
    const signInHint = (logs: string) => logs.split('\n').find((line) => line.includes('login'))
    const needsSignIn = {
      'mcp:get-configuration': () => view([server({ name: 'sentry', usesOAuth: true })]),
      'mcp:inspect-server': ({ name }: { readonly name: string }) => ({
        name,
        state: 'needs-sign-in' as const,
        tools: [],
      }),
    }

    const doctor = await run('doctor', args, needsSignIn)
    const list = await run('list', args, needsSignIn)

    expect(signInHint(doctor.logs)?.trim()).toBe(`sign in with: ${command}`)
    expect(signInHint(list.logs)?.trim()).toBe(`sign in with: ${command}`)
  })
})
