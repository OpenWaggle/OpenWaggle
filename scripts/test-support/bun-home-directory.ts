/**
 * Bun resolves `os.homedir()` from the environment it started with, and a runtime write to
 * `process.env['HOME']` never reaches it. Node reads HOME on every call. The test tiers set a
 * temporary HOME per file (`isolate-user-home.ts`), so on Bun `node-os.ts` replaces `homedir` with
 * one that reads it at call time. Test-only: code under test that needs another home should take
 * it as a parameter rather than rely on this.
 */

/** Node's own order: HOME on POSIX; USERPROFILE on Windows, which ignores HOME. */
export function homeFromEnvironment(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  const value = platform === 'win32' ? environment['USERPROFILE'] : environment['HOME']
  return value === undefined || value === '' ? undefined : value
}

interface HomedirOwner {
  homedir(): string
}

/** Makes `builtin.homedir()` follow HOME at call time when running on Bun. */
export function followHomeEnvironmentOnBun(runtime: NodeJS.Dict<string>, builtin: HomedirOwner) {
  if (runtime['bun'] === undefined) return
  const startupHomedir = builtin.homedir.bind(builtin)
  builtin.homedir = () => homeFromEnvironment(process.env, process.platform) ?? startupHomedir()
}
