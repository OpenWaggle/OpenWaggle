import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/** The published npm surface. */
const PUBLISHABLE_PATH_PREFIX = 'packages/'

/**
 * Whether the head differs from the base under `packages/`.
 *
 * Read with `-z`, so a path git would otherwise C-quote cannot hide its prefix. Falls back to the
 * validated range start when the requested base is not usable as a diff endpoint.
 */
export async function touchesPublishablePackage(input: {
  readonly base: string
  readonly cwd: string
  readonly fallbackBase: string
  readonly to: string
}) {
  for (const base of [input.base, input.fallbackBase]) {
    try {
      const { stdout } = await execFile(
        'git',
        ['diff', '--name-only', '-z', base, input.to, '--', PUBLISHABLE_PATH_PREFIX],
        { cwd: input.cwd },
      )
      return stdout.split('\0').some((entry) => entry.length > 0)
    } catch {
      // Try the next candidate base.
    }
  }
  return false
}
