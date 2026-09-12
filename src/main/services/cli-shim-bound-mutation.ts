import { runManagedShimMutationInternal } from './cli-shim-mutation-runner'

const EXECUTABLE_MODE = 0o755

/**
 * Runs inside the packaged Electron executable with `ELECTRON_RUN_AS_NODE=1`.
 *
 * The helper's cwd is the descriptor-pinned command directory. New bytes arrive
 * through inherited fd 3, never through a path that an untrusted peer can swap.
 * Create uses hard-link no-replace semantics. Replace atomically preserves the
 * current target in a private recovery directory, then installs no-replace; the
 * bounded gap favors retaining raced-in user data over path continuity because
 * standard Node exposes no pathname compare-and-swap. Every cleanup checks the
 * inode it created before unlinking, so hostile replacements are not deleted.
 */
const NODE_CLI_SHIM_MUTATION = String.raw`
const crypto = require('node:crypto')
const fs = require('node:fs')

const [mode, target, pendingName, expectedDirectory, expectedIdentity, expectedDigest] = process.argv.slice(1)
const constants = fs.constants
const noFollow = constants.O_NOFOLLOW || 0
const identity = (stats) => stats.dev + ':' + stats.ino
const directory = fs.statSync('.')
if (identity(directory) !== expectedDirectory) process.exit(73)

let pendingIdentity
let pendingDigest
let pendingHandle
let recoveryIdentity
let commitIdentity
let retainRecovery = false
let retainCommit = false
let recoveryRoot
let recoveryRootIdentity
let recoveryName
let commitName

function pathIdentity(name) {
  try {
    return identity(fs.lstatSync(name))
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function unlinkOwned(name, ownedIdentity) {
  if (name && ownedIdentity && pathIdentity(name) === ownedIdentity) fs.unlinkSync(name)
}

function prepareRecoveryRoot() {
  recoveryRoot = fs.mkdtempSync('.openwaggle-cli-recovery-')
  fs.chmodSync(recoveryRoot, 0o700)
  recoveryRootIdentity = pathIdentity(recoveryRoot)
  recoveryName = recoveryRoot + '/authorized'
  commitName = recoveryRoot + '/displaced'
}

function cleanupPending() {
  if (pendingHandle !== undefined) {
    fs.closeSync(pendingHandle)
    pendingHandle = undefined
  }
  unlinkOwned(pendingName, pendingIdentity)
  if (!retainCommit) unlinkOwned(commitName, commitIdentity)
  if (!retainRecovery) unlinkOwned(recoveryName, recoveryIdentity)
  if (
    !retainCommit &&
    !retainRecovery &&
    recoveryRootIdentity &&
    pathIdentity(recoveryRoot) === recoveryRootIdentity
  ) {
    try {
      fs.rmdirSync(recoveryRoot)
    } catch (error) {
      if (!error || error.code !== 'ENOTEMPTY') throw error
    }
  }
}

for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    recoverMutation(new Error('CLI shim mutation was interrupted.'))
    cleanupPending()
    process.exit(128)
  })
}

function readDescriptor(fd) {
  const chunks = []
  const buffer = Buffer.allocUnsafe(64 * 1024)
  while (true) {
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, null)
    if (bytes === 0) break
    chunks.push(Buffer.from(buffer.subarray(0, bytes)))
  }
  return Buffer.concat(chunks)
}

function waitForRelease() {
  const byte = Buffer.allocUnsafe(1)
  while (fs.readSync(0, byte, 0, 1, null) !== 0) {
    if (byte[0] === 10) return
  }
  throw new Error('CLI shim mutation authorization closed early.')
}

function validatePending() {
  const stats = fs.fstatSync(pendingHandle)
  if (!stats.isFile() || identity(stats) !== pendingIdentity || pathIdentity(pendingName) !== pendingIdentity) {
    throw new Error('Pending CLI shim identity changed.')
  }
  const readHandle = fs.openSync(pendingName, constants.O_RDONLY | noFollow)
  try {
    const readStats = fs.fstatSync(readHandle)
    const digest = crypto.createHash('sha256').update(readDescriptor(readHandle)).digest('hex')
    if (identity(readStats) !== pendingIdentity || digest !== pendingDigest) {
      throw new Error('Pending CLI shim content changed.')
    }
  } finally {
    fs.closeSync(readHandle)
  }
}

function linkTarget(name) {
  const handle = fs.openSync(target, constants.O_RDONLY | noFollow)
  try {
    const stats = fs.fstatSync(handle)
    if (!stats.isFile()) throw new Error('CLI target is not a regular file.')
    const sourceIdentity = identity(stats)
    fs.linkSync(target, name)
    return sourceIdentity
  } finally {
    fs.closeSync(handle)
  }
}

function validateTarget(linkName, linkedIdentity, targetState) {
  const handle = fs.openSync(linkName, constants.O_RDONLY | noFollow)
  try {
    const stats = fs.fstatSync(handle)
    const targetIdentity = pathIdentity(target)
    if (
      !stats.isFile() ||
      identity(stats) !== expectedIdentity ||
      linkedIdentity !== expectedIdentity ||
      pathIdentity(linkName) !== expectedIdentity ||
      (targetState === 'linked' ? targetIdentity !== expectedIdentity : targetIdentity !== undefined)
    ) {
      throw new Error('CLI target identity changed.')
    }
    const digest = crypto.createHash('sha256').update(readDescriptor(handle)).digest('hex')
    if (digest !== expectedDigest) throw new Error('CLI target content changed.')
  } finally {
    fs.closeSync(handle)
  }
}

function restoreNoReplace(name, ownedIdentity) {
  if (!ownedIdentity || pathIdentity(name) !== ownedIdentity) return false
  try {
    fs.linkSync(name, target)
  } catch (error) {
    if (error && error.code === 'EEXIST') return false
    throw error
  }
  if (pathIdentity(target) !== ownedIdentity) return false
  unlinkOwned(name, ownedIdentity)
  return true
}

function recoverMutation(error) {
  if (commitIdentity) {
    if (pathIdentity(target) === commitIdentity) return error
    if (restoreNoReplace(commitName, commitIdentity)) return error
    retainCommit = pathIdentity(commitName) === commitIdentity
    if (retainCommit) {
      return new Error(
        (error instanceof Error ? error.message : String(error)) +
          ' The preserved target remains recoverable at ' +
          require('node:path').resolve(commitName) +
          '.',
      )
    }
  }
  if (recoveryIdentity) {
    if (pathIdentity(target) === recoveryIdentity) return error
    if (restoreNoReplace(recoveryName, recoveryIdentity)) return error
    retainRecovery = pathIdentity(recoveryName) === recoveryIdentity
    if (retainRecovery) {
      return new Error(
        (error instanceof Error ? error.message : String(error)) +
          ' The managed target remains recoverable at ' +
          require('node:path').resolve(recoveryName) +
          '.',
      )
    }
  }
  return error
}

try {
  if (mode !== 'remove') {
    pendingHandle = fs.openSync(
      pendingName,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      ${String(EXECUTABLE_MODE)},
    )
    pendingIdentity = identity(fs.fstatSync(pendingHandle))
    const content = readDescriptor(3)
    pendingDigest = crypto.createHash('sha256').update(content).digest('hex')
    fs.writeFileSync(pendingHandle, content)
    fs.fchmodSync(pendingHandle, ${String(EXECUTABLE_MODE)})
    fs.fsyncSync(pendingHandle)
  }

  process.stdout.write('ready\n')
  waitForRelease()

  if (mode === 'create') {
    validatePending()
    fs.linkSync(pendingName, target)
    if (pathIdentity(target) !== pendingIdentity) throw new Error('Created CLI shim identity changed.')
  } else if (mode === 'replace' || mode === 'remove') {
    prepareRecoveryRoot()
    recoveryIdentity = linkTarget(recoveryName)
    validateTarget(recoveryName, recoveryIdentity, 'linked')
    process.stdout.write('validated\n')
    waitForRelease()

    fs.renameSync(target, commitName)
    commitIdentity = pathIdentity(commitName)
    if (!commitIdentity) throw new Error('CLI target displacement disappeared.')
    validateTarget(commitName, commitIdentity, 'absent')
    process.stdout.write('displaced\n')
    waitForRelease()
    if (mode === 'replace') {
      validatePending()
      fs.linkSync(pendingName, target)
      if (pathIdentity(target) !== pendingIdentity) throw new Error('Replaced CLI shim identity changed.')
    }
  } else {
    throw new Error('Unsupported CLI shim mutation.')
  }
} catch (error) {
  const recovered = recoverMutation(error)
  process.stderr.write(recovered instanceof Error ? recovered.message : String(recovered))
  process.exitCode = 74
} finally {
  cleanupPending()
}
`

export interface CliShimMutationServiceInput {
  readonly platform: NodeJS.Platform
  readonly homeDirectory: string
  readonly beforeManagedReplacement?: () => Promise<void>
  readonly beforeManagedCommit?: () => Promise<void>
  readonly afterManagedDisplacement?: () => Promise<void>
  readonly beforeManagedSpawn?: (input: {
    readonly directory: string
    readonly pendingName: string
  }) => Promise<void>
}

export interface ExpectedShim {
  readonly identity: string
  readonly digest: string
}

export interface ManagedShimMutationInput {
  readonly service: CliShimMutationServiceInput
  readonly target: string
  readonly expectedContent?: string
  readonly mode: 'create' | 'replace' | 'remove'
  readonly expectedTarget?: ExpectedShim
}

export function runManagedShimMutation(input: ManagedShimMutationInput) {
  return runManagedShimMutationInternal(input, NODE_CLI_SHIM_MUTATION)
}
