import { describe, expect, it } from 'vitest'
import { run, server, view } from './mcp-cli-management.test-fixtures'

/** Maintainer decision 1: OpenWaggle runs `direct` as `codemode` and never offers it. */
describe('openwaggle mcp and direct exposure', () => {
  it('refuses to add a server with --exposure direct and points to codemode', async () => {
    const result = await run('add', ['tools', '--exposure', 'direct', '--', 'npx', 'tools'], {
      'mcp:get-configuration': () => view([]),
    })

    expect(result.exitCode).toBe(2)
    expect(result.errors).toContain('no longer offers --exposure direct')
    expect(result.errors).toContain('Use --exposure codemode.')
    expect(result.calls.some((call) => call.channel === 'mcp:add-server')).toBe(false)
  })

  it.each(['codemode', 'deferred', 'hidden'])('adds a server with --exposure %s', async (mode) => {
    const result = await run('add', ['tools', '--exposure', mode, '--', 'npx', 'tools'], {
      'mcp:get-configuration': () => view([]),
      'mcp:add-server': () => view([server({ name: 'tools' })]),
    })

    expect(result.exitCode).toBe(0)
    expect(result.calls[1]?.input).toMatchObject({ entry: { exposure: mode } })
  })

  it('refuses an unknown exposure and lists only the ones OpenWaggle offers', async () => {
    const result = await run('add', ['tools', '--exposure', 'eager', '--', 'npx', 'tools'], {})

    expect(result.exitCode).toBe(2)
    expect(result.errors).toContain(
      '--exposure must be one of codemode, deferred, hidden; got "eager".',
    )
  })

  it('lists a server its file sets to direct as codemode, and leaves the file as it is', async () => {
    const result = await run('list', [], {
      'mcp:get-configuration': () => view([server({ name: 'docs', exposure: 'direct' })]),
      'mcp:inspect-server': (input) => ({
        name: input.name,
        state: 'connected',
        tools: [{ name: 'search', exposure: 'direct', hasApp: false }],
      }),
    })

    expect(result.logs).toContain('docs: connected, 1 tool (codemode, global)')
    // The server's own exposure: no per-tool override to show.
    expect(result.logs).toContain('tools: search')
    expect(result.logs).not.toContain('direct')
    expect(result.calls.map((call) => call.channel)).toEqual([
      'mcp:get-configuration',
      'mcp:inspect-server',
    ])
  })

  it('reports what the file says beside what OpenWaggle runs in JSON', async () => {
    const result = await run('list', ['--json'], {
      'mcp:get-configuration': () =>
        view([server({ name: 'docs', exposure: 'direct' }), server({ name: 'plain' })]),
      'mcp:inspect-server': (input) => ({ name: input.name, state: 'connected', tools: [] }),
    })
    const parsed: unknown = JSON.parse(result.logs)

    expect(Reflect.get(Object(parsed), 'result')).toMatchObject({
      servers: [
        { name: 'docs', exposure: 'codemode', configuredExposure: 'direct' },
        { name: 'plain', exposure: 'codemode' },
      ],
    })
    const servers = Reflect.get(Object(Reflect.get(Object(parsed), 'result')), 'servers')
    expect(Array.isArray(servers) ? servers[1] : undefined).not.toHaveProperty('configuredExposure')
  })
})
