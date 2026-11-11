import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchHeadlessBackgroundProcess } from '../../../../src/main/desktop-ui'
import { getSessionHostChildEnv } from '../../../../src/main/env'
import {
  WINDOWS_DETACHED_PROCESS_ARGUMENTS,
  WINDOWS_DETACHED_PROCESS_SENTINEL_KEY,
} from '../windows-detached-process-values'

const READY_TIMEOUT_MS = 10_000
const CHILD_LIFETIME_MS = 25_000
const POLL_INTERVAL_MS = 25

const [mode, directoryArgument, ...receivedArguments] = process.argv.slice(2)
if ((mode !== 'parent' && mode !== 'child') || !directoryArgument) {
  throw new Error('Detached-process probe requires its mode and private directory.')
}
const directory = directoryArgument

async function publishReady(fileName: string, value: unknown) {
  const filePath = path.join(directory, fileName)
  await fs.writeFile(`${filePath}.tmp`, JSON.stringify(value))
  await fs.rename(`${filePath}.tmp`, filePath)
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function run() {
  if (mode === 'child') {
    const deadline = Date.now() + CHILD_LIFETIME_MS
    await publishReady('child-ready.json', {
      pid: process.pid,
      arguments: receivedArguments,
      environmentSentinel: process.env[WINDOWS_DETACHED_PROCESS_SENTINEL_KEY],
    })
    while (Date.now() < deadline && !(await exists(path.join(directory, 'stop-child')))) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    await fs.writeFile(path.join(directory, 'child-stopped'), '')
    return
  }

  await launchHeadlessBackgroundProcess({
    command: process.execPath,
    args: [
      fileURLToPath(import.meta.url),
      'child',
      directory,
      ...WINDOWS_DETACHED_PROCESS_ARGUMENTS,
    ],
    environment: {
      ...getSessionHostChildEnv(),
      OPENWAGGLE_AUTOMATION: '1',
      [WINDOWS_DETACHED_PROCESS_SENTINEL_KEY]: process.env[WINDOWS_DETACHED_PROCESS_SENTINEL_KEY],
    },
  })
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (!(await exists(path.join(directory, 'child-ready.json')))) {
    if (Date.now() >= deadline) throw new Error('Detached child did not become ready.')
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  await publishReady('parent-ready.json', { pid: process.pid, versions: process.versions })
}

void run().catch(async (error: unknown) => {
  await fs.writeFile(path.join(directory, `${mode}-error.txt`), String(error))
  process.exitCode = 1
})
