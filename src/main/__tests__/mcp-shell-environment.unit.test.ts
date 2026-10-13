import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShellEnvironmentCommand } from '../desktop-shell-environment-probes'
import {
  currentMcpShellEnvironment,
  loadMcpShellEnvironment,
  mcpValueEnvironment,
  resetMcpShellEnvironmentForTests,
} from '../mcp-shell-environment'

const START = '__OPENWAGGLE_ENV_ALL_START__'
const END = '__OPENWAGGLE_ENV_ALL_END__'

function shellOutput(variables: Readonly<Record<string, string>>) {
  const body = Object.entries(variables)
    .map(([name, value]) => `${name}=${value}\0`)
    .join('')
  // Startup files may print anything around the markers.
  return `Welcome!\n${START}\n${body}\n${END}\nbye\n`
}

afterEach(() => {
  resetMcpShellEnvironmentForTests()
  vi.unstubAllEnvs()
})

describe("the user's login-shell environment for MCP values", () => {
  it('reads every variable of the login shell, including multi-line values', async () => {
    const runner = vi.fn(async (_command: ShellEnvironmentCommand) =>
      shellOutput({ ONLY_IN_SHELL: 'from-zshrc', MULTI: 'line one\nline two' }),
    )

    await loadMcpShellEnvironment({ platform: 'darwin', shells: ['/bin/zsh'], runner })

    expect(currentMcpShellEnvironment()).toEqual({
      ONLY_IN_SHELL: 'from-zshrc',
      MULTI: 'line one\nline two',
    })
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ probe: 'login-shell-full', command: '/bin/zsh' }),
    )
  })

  it("lets the app's own environment win and adds what only the shell has", async () => {
    vi.stubEnv('SHARED', 'from-process')
    await loadMcpShellEnvironment({
      platform: 'linux',
      shells: ['/bin/bash'],
      runner: async () => shellOutput({ SHARED: 'from-shell', ONLY_IN_SHELL: 'x' }),
    })

    expect(mcpValueEnvironment()).toMatchObject({ SHARED: 'from-process', ONLY_IN_SHELL: 'x' })
  })

  it('captures once and is empty when the shell gives nothing', async () => {
    const runner = vi.fn(async () => 'no markers here')

    await loadMcpShellEnvironment({ platform: 'darwin', shells: ['/bin/zsh'], runner })
    await loadMcpShellEnvironment({ platform: 'darwin', shells: ['/bin/zsh'], runner })

    expect(currentMcpShellEnvironment()).toEqual({})
    expect(runner).toHaveBeenCalledOnce()
  })
})
