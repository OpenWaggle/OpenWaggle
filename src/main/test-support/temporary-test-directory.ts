import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { onTestFinished } from 'vitest'

/**
 * A directory in the test file's temporary directory, removed when the calling test finishes.
 * Every test file must leave its temporary directory empty (`isolate-user-home.ts`). Call it
 * inside a test, not in a hook.
 */
export async function temporaryTestDirectory(prefix: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

/**
 * Removes the entries starting with `prefix` from the test file's temporary directory, for files
 * that code under test creates there itself, such as a per-process cache.
 */
export async function removeTemporaryEntries(prefix: string) {
  const temporaryDirectory = os.tmpdir()
  for (const entry of await fs.readdir(temporaryDirectory)) {
    if (!entry.startsWith(prefix)) continue
    await fs.rm(path.join(temporaryDirectory, entry), { recursive: true, force: true })
  }
}
