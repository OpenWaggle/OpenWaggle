/** How the package-runner probe is spawned (D1.2, review R5 P1-2). */
import { execFile } from 'node:child_process'
import { windowsCommandLine } from './mcp-package-runner-launch'

const PROBE_TIMEOUT_MS = 180_000
const PROBE_OUTPUT_BYTES = 1_000_000

export type PackageRunnerProbe = (input: {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}) => Promise<string>

/** How a probe is spawned: never through Node's `shell`, which leaves arguments unquoted. */
export function probeSpawnOf(
  input: Parameters<PackageRunnerProbe>[0],
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'win32') {
    return { file: input.command, args: [...input.args], windowsVerbatimArguments: false }
  }
  // `npx.cmd` needs `cmd.exe` (Node refuses to spawn a `.cmd` without it), which gets one line
  // escaped for it.
  return {
    file: input.env.ComSpec ?? input.env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', windowsCommandLine(input.command, input.args)],
    windowsVerbatimArguments: true,
  }
}

export const execProbe: PackageRunnerProbe = (input) =>
  new Promise((resolve, reject) => {
    const spawned = probeSpawnOf(input)
    execFile(
      spawned.file,
      spawned.args,
      {
        cwd: input.cwd,
        env: { ...input.env },
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: PROBE_OUTPUT_BYTES,
        windowsHide: true,
        windowsVerbatimArguments: spawned.windowsVerbatimArguments,
        shell: false,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
