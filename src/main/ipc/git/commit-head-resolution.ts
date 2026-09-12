import { setTimeout as delay } from 'node:timers/promises'
import { runGit } from './shared'

const COMMIT_HASH_RESOLUTION_ATTEMPTS = 3
const COMMIT_HASH_RETRY_DELAY_MS = 20
const FULL_COMMIT_HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu

/** Resolve the commit Git just created without ever asking the caller to repeat the commit. */
export async function resolveCommittedHead(projectPath: string): Promise<string | null> {
  let attempt = 0
  while (attempt < COMMIT_HASH_RESOLUTION_ATTEMPTS) {
    const hashResult = await runGit(projectPath, ['rev-parse', 'HEAD'])
    const candidate = hashResult.code === 0 ? hashResult.stdout.trim() : ''
    if (FULL_COMMIT_HASH_PATTERN.test(candidate)) return candidate
    attempt += 1
    if (attempt < COMMIT_HASH_RESOLUTION_ATTEMPTS) await delay(COMMIT_HASH_RETRY_DELAY_MS)
  }
  return null
}
