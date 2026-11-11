/**
 * The base ref a branch check compares with: `--base <ref>` when given, else the merge base with
 * origin/main, else origin/main, else HEAD (with a one-line warning from the caller's name).
 */
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const GIT_OUTPUT_LIMIT = 64 * 1024 * 1024

export async function gitOrUndefined(root: string, args: readonly string[]) {
  try {
    const { stdout } = await execFile('git', [...args], {
      cwd: root,
      maxBuffer: GIT_OUTPUT_LIMIT,
    })
    return stdout.trim()
  } catch {
    return undefined
  }
}

export function parseBaseArgument(argv: readonly string[]) {
  const index = argv.indexOf('--base')
  if (index < 0) return undefined
  const ref = argv[index + 1]
  if (!ref || ref.startsWith('--')) throw new Error('--base needs a git ref')
  return ref
}

export async function resolveBase(root: string, requested: string | undefined, check: string) {
  if (requested) return requested
  const mergeBase = await gitOrUndefined(root, ['merge-base', 'HEAD', 'origin/main'])
  if (mergeBase) return mergeBase
  const main = await gitOrUndefined(root, ['rev-parse', '--verify', '--quiet', 'origin/main'])
  if (main) return main
  console.warn(`${check}: no origin/main; comparing with HEAD, so uncommitted changes only`)
  return 'HEAD'
}
