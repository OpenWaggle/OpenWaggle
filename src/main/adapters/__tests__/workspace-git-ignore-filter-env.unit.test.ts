import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R6 P3-8: git finds the global excludes file through HOME, or USERPROFILE / HOMEDRIVE+HOMEPATH on
 * Windows, so the watcher's ignore filter runs git with the user's environment, as runGit does,
 * and only once the login-shell environment is ready.
 */
interface ExecCall {
  readonly args: readonly string[]
  readonly env: Record<string, string | undefined>
}

const calls: ExecCall[] = []
const shell = vi.hoisted(() => {
  let release: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  return { ready, release: () => release() }
})

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: readonly string[],
    options: { readonly env: Record<string, string | undefined> },
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    calls.push({ args, env: options.env })
    queueMicrotask(() => callback(null, args.includes('rev-parse') ? 'true\n' : ''))
    return { stdin: { end: () => undefined } }
  },
}))

vi.mock('../../env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../env')>()),
  desktopShellEnvironmentReady: () => shell.ready,
}))

beforeEach(() => {
  calls.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('workspace git-ignore filter environment', () => {
  it('runs git with the Windows home variables, after the shell environment is ready', async () => {
    vi.stubEnv('USERPROFILE', 'C:\\Users\\me')
    vi.stubEnv('HOMEDRIVE', 'C:')
    vi.stubEnv('HOMEPATH', '\\Users\\me')
    vi.stubEnv('XDG_CONFIG_HOME', '/home/me/.config')
    const { WorkspaceGitIgnoreFilter } = await import('../workspace-git-ignore-filter')

    const created = WorkspaceGitIgnoreFilter.create('/repo')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    shell.release()
    await created

    expect(calls[0]?.env).toMatchObject({
      USERPROFILE: 'C:\\Users\\me',
      HOMEDRIVE: 'C:',
      HOMEPATH: '\\Users\\me',
      XDG_CONFIG_HOME: '/home/me/.config',
    })
  })
})
