import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { prepareDesktopUi } from '../../../../src/main/desktop-window-policy'
import { getSafeChildEnv } from '../../../../src/main/env'
import { generateProfileCredential } from '../../../../src/main/session-host/profile-credential'
import {
  readProfileCredentialFile,
  stageProfileCredential,
} from '../../../../src/main/session-host/profile-credential-destination'
import { openUnlinkedCredentialSource } from '../../../../src/main/session-host/profile-credential-destination-support'

const CHILD_TIMEOUT_MS = 10_000
const FD_SENTINEL = 'openwaggle-protected-staging-fd3-probe'
const FD_READER = `
const fs = require('node:fs');
try {
  process.stdout.write(fs.readFileSync(3, 'utf8') === '${FD_SENTINEL}' ? 'MATCH' : 'MISMATCH');
} catch { process.exitCode = 1; }
`

const [directory] = process.argv.slice(2)
prepareDesktopUi(app)
if (!directory) throw new Error('Protected-staging probe requires its private directory.')
app.setPath('userData', path.join(directory, 'profile'))

function failure(stage: string, error: unknown) {
  const code =
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)
      ? error.code
      : 'UNCLASSIFIED'
  const syscall =
    error instanceof Error &&
    'syscall' in error &&
    typeof error.syscall === 'string' &&
    /^[a-z_]{1,32}$/u.test(error.syscall)
      ? error.syscall
      : 'unavailable'
  return { ok: false, stage, code, syscall }
}

async function directorySharingProbe() {
  const target = path.join(directory, 'sharing')
  await fs.mkdir(target)
  const handle = await fs.open(target, 'r')
  let held
  try {
    await fs.realpath(target)
    held = { ok: true }
  } catch (error) {
    held = failure('realpath-while-open', error)
  } finally {
    await handle.close()
  }
  try {
    await fs.realpath(target)
    return { held, closed: { ok: true } }
  } catch (error) {
    return { held, closed: failure('realpath-after-close', error) }
  }
}

async function descriptorProbe() {
  const source = await openUnlinkedCredentialSource(FD_SENTINEL)
  try {
    return await new Promise<{ readonly ok: boolean; readonly exitCode: number | null }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, ['-e', FD_READER], {
          env: { ...getSafeChildEnv(), ELECTRON_RUN_AS_NODE: '1' },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore', source.fd],
        })
        const timer = setTimeout(() => child.kill('SIGKILL'), CHILD_TIMEOUT_MS)
        let output = ''
        child.stdout?.on('data', (chunk: Buffer) => {
          output = `${output}${chunk.toString('utf8')}`.slice(0, FD_SENTINEL.length)
        })
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.once('close', (exitCode) => {
          clearTimeout(timer)
          resolve({ ok: exitCode === 0 && output === 'MATCH', exitCode })
        })
      },
    )
  } finally {
    await source.close()
  }
}

async function protectedStagingProbe() {
  let stage = 'prepare'
  try {
    const credential = generateProfileCredential()
    const target = path.join(directory, 'credentials', 'worker.credential')
    const staged = await stageProfileCredential({
      destination: { kind: 'file', path: target },
      stateRoot: path.join(directory, 'state'),
      profileName: 'windows-qa-worker',
      credential,
      replace: false,
      stagingKey: 'windows-native-staging',
    })
    stage = 'commit'
    await staged.commit()
    stage = 'read'
    const installed = await readProfileCredentialFile(target)
    return { ok: installed === credential, stage }
  } catch (error) {
    return failure(stage, error)
  }
}

async function run() {
  await app.whenReady()
  const result = {
    identity: {
      pid: process.pid,
      electron: process.versions.electron,
      node: process.versions.node,
      uv: process.versions.uv,
    },
    directorySharing: await directorySharingProbe().catch((error: unknown) => ({
      held: failure('directory-open', error),
      closed: failure('directory-control-unavailable', error),
    })),
    descriptor: await descriptorProbe().catch((error: unknown) => failure('inherited-fd3', error)),
    protectedStaging: await protectedStagingProbe(),
  }
  // Credentials and unrestricted exception messages never enter the diagnostic record.
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(result))
  app.quit()
}

void run().catch(async (error: unknown) => {
  await fs.writeFile(
    path.join(directory, 'startup-error.json'),
    JSON.stringify(failure('startup', error)),
  )
  app.exit(1)
})
