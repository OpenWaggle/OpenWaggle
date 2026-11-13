import { spawn } from 'node:child_process'
import path from 'node:path'
import { TIME_UNIT } from '@shared/constants/time'
import { getDesktopHelperChildEnv } from '../../env'
import { createElectronSafeStorageReader } from '../../electron-migration/electron-safe-storage'
import {
  acknowledgeLocalStorageImport,
  type ElectronMigrationOptions,
  runElectronMigration,
  skipMigrationStep,
} from '../../electron-migration/electron-migrator'
import type { MigrationStep } from '../../electron-migration/migration-state'
import {
  type CommandResult,
  createOsKeySources,
  type KeychainReader,
} from '../../electron-migration/os-key-sources'
import { createLogger } from '../../logger'
import { sharedMcpStateDirectory } from '../mcp/credentials/mcp-build-state-paths'
import { withProcessFileLock } from '../process-file-lock'
import { electrobunBootShell } from './electrobun-boot-shell'
import { electrobunSecureStorage } from './electrobun-secure-storage'

/**
 * The first launch after the Electron build (docs/electrobun-transition.md): runs the migrator
 * with the Electrobun shell's paths, the keychain sealer of its SecureStorage, and the OS key
 * sources for Electron's `safeStorage`. It runs off the startup path (the window does not wait);
 * each keychain read gives up after `KEYCHAIN_TIMEOUT_MS`, so an unanswered prompt leaves the
 * secrets step `blocked` and the next launch tries again.
 */
const KEYCHAIN_TIMEOUT_MS = 20 * TIME_UNIT.MILLISECONDS_PER_SECOND
const MIGRATION_LOCK_FILE = 'migration-state'
const MIGRATION_LOCK_WAIT_MS = 60 * TIME_UNIT.MILLISECONDS_PER_SECOND

const logger = createLogger('electron-migration')

function migrationPlatform() {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform
  return 'linux' as const
}

function withTimeout<T>(label: string, operation: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not answer in time (a keychain prompt?)`)),
      KEYCHAIN_TIMEOUT_MS,
    )
  })
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer))
}

function runCommand(command: string, args: readonly string[], input?: string) {
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(command, [...args], {
      env: getDesktopHelperChildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: KEYCHAIN_TIMEOUT_MS,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => resolve({ exitCode: null, stdout, stderr: String(error) }))
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
    child.stdin.end(input ?? '')
  })
}

interface BunSecretsReader {
  readonly secrets: KeychainReader
}

function isBunSecretsReader(value: unknown): value is BunSecretsReader {
  if (typeof value !== 'object' || value === null) return false
  const secrets: unknown = Reflect.get(value, 'secrets')
  return (
    typeof secrets === 'object' &&
    secrets !== null &&
    typeof Reflect.get(secrets, 'get') === 'function'
  )
}

/** The macOS login keychain through this process's `Bun.secrets`, each read bounded. */
function keychainReader() {
  const bun: unknown = Reflect.get(globalThis, 'Bun')
  if (!isBunSecretsReader(bun)) return undefined
  return {
    get: (item) => withTimeout(`The keychain item ${item.service}`, bun.secrets.get(item)),
  } satisfies KeychainReader | undefined
}

interface MigrationRun {
  readonly steps?: readonly MigrationStep[]
  /** A run the user asked for retries a step past the automatic attempt cap. */
  readonly userRequested?: boolean
}

function migrationOptions(run: MigrationRun = {}) {
  const userData = electrobunBootShell.userData()
  const keychain = keychainReader()
  const reader = createElectronSafeStorageReader(
    createOsKeySources({
      platform: migrationPlatform(),
      // Electron's `safeStorage` named its key after the app name, which is userData's name.
      appName: path.basename(userData),
      userData,
      runCommand,
      ...(keychain ? { keychain } : {}),
    }),
  )
  const options: ElectronMigrationOptions = {
    userData,
    sharedMcpDirectory: sharedMcpStateDirectory(),
    codec: {
      decryptLegacy: (blob: Buffer) => reader.decrypt(blob),
      seal: async (plaintext: string) => electrobunSecureStorage.encryptString(plaintext),
    },
    withLock: <T>(operation: () => Promise<T>) =>
      withProcessFileLock(path.join(userData, MIGRATION_LOCK_FILE), operation, {
        waitUntilAvailable: true,
        maxWaitMs: MIGRATION_LOCK_WAIT_MS,
      }),
    log: (message, context) => logger.info(message, { ...context }),
    ...(run.steps ? { steps: run.steps } : {}),
    ...(run.userRequested ? { maxAttempts: Number.POSITIVE_INFINITY } : {}),
  }
  return options
}

/** Runs every unfinished step; resolves with the state and any localStorage import to apply. */
export function runElectrobunFirstLaunchMigration(run?: MigrationRun) {
  return runElectronMigration(migrationOptions(run))
}

/** The user will enter this step's data again. */
export function skipElectrobunMigrationStep(step: MigrationStep) {
  return skipMigrationStep(migrationOptions(), step)
}

/** The renderer applied the exported localStorage. */
export function acknowledgeElectrobunLocalStorageImport(importId: string) {
  return acknowledgeLocalStorageImport(migrationOptions(), importId)
}
