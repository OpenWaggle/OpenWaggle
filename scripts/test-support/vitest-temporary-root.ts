/**
 * Vitest global setup: one temporary root per run, under which every test file gets its own
 * temporary directory (`isolate-user-home.ts`). Removing the root at the end of the run also
 * removes what files that never reached their teardown left: a file whose tests are all skipped
 * (platform-gated suites) runs no `afterAll` hook, and a crashed worker runs none either.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'

const POSIX_TEMPORARY_DIRECTORY = '/tmp'
const REMOVE_RETRY_COUNT = 10
const REMOVE_RETRY_DELAY_MS = 100

declare module 'vitest' {
  export interface ProvidedContext {
    openwaggleTestTemporaryRoot: string
  }
}

/**
 * Unix socket paths have a limit of about 104 bytes, and tests listen on sockets in their
 * temporary directory. The run and file directories add 28 bytes, so on POSIX the root lives in
 * `/tmp`, shorter than macOS's per-user temporary directory (49 bytes before `/private`).
 */
function temporaryBase() {
  return process.platform === 'win32' ? os.tmpdir() : POSIX_TEMPORARY_DIRECTORY
}

export default function setup(project: TestProject) {
  const root = fs.mkdtempSync(path.join(temporaryBase(), 'owvt-'))
  project.provide('openwaggleTestTemporaryRoot', root)
  return () => {
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: REMOVE_RETRY_COUNT,
      retryDelay: REMOVE_RETRY_DELAY_MS,
    })
  }
}
