/**
 * The first-launch migration from the Electron build: idempotent, resumable, and independent of the
 * desktop shell. Paths, the old `safeStorage` reader, the new keychain sealer and the cross-process
 * lock are injected, so the Electrobun shell wires them from its AppPaths and secure-storage ports.
 *
 * Steps (each recorded in `migration-state.json`, see `migration-state.ts`):
 * 1. `local-storage`: export the renderer's Electron `localStorage` to `electron-local-storage.json`;
 *    the new renderer applies it before it starts and acknowledges it (`acknowledgeLocalStorageImport`).
 * 2. `secrets`: re-seal every `safeStorage` blob with the keychain sealer (`secret-files.ts`).
 * 3. `browser-preview-reset`: remove the Electron browser-preview partitions; the new engine cannot
 *    read their cookies, so the user signs in to previewed sites again.
 * User data itself never moves: sessions, settings, SQLite and MCP config stay where they are.
 */
import { randomUUID } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { readElectronLocalStorage } from './chromium-local-storage'
import { SafeStorageDecryptError } from './electron-safe-storage'
import {
  initialMigrationState,
  isStepFinal,
  MIGRATION_STEPS,
  type MigrationState,
  type MigrationStep,
  type MigrationStepStatus,
  readMigrationState,
  withStep,
  writeMigrationState,
} from './migration-state'
import { migrateSecretFiles, type SecretCodec } from './secret-files'
import {
  writeLocalStorageExport,
  readLocalStorageExport,
  removeLocalStorageExport,
} from './local-storage-export'
import { isObjectValue } from '@shared/utils/object-shape'

export const ELECTRON_SESSION_DATA_DIRECTORY = 'session-data'
export const ELECTRON_RENDERER_ORIGIN = 'openwaggle://app'
const BROWSER_PREVIEW_PARTITION_PREFIX = 'openwaggle-browser-preview'
const DEFAULT_MAX_ATTEMPTS = 5

export interface ElectronMigrationOptions {
  /** The canonical userData directory the Electron build used (AppPaths). */
  readonly userData: string
  /** `~/.openwaggle/mcp`. */
  readonly sharedMcpDirectory: string
  readonly codec: SecretCodec
  /** A cross-process lock for the whole run, held under userData. */
  readonly withLock: <T>(operation: () => Promise<T>) => Promise<T>
  /** Runs only these steps now, for example to ask before the secrets step touches the keychain. */
  readonly steps?: readonly MigrationStep[]
  readonly rendererOrigin?: string
  readonly maxAttempts?: number
  readonly now?: () => Date
  readonly log?: (message: string, context: MigrationLogContext) => void
}

export interface MigrationLogContext {
  readonly fromElectron?: boolean
  readonly step?: MigrationStep
  readonly status?: MigrationStepStatus
  readonly error?: string
}

export interface PendingLocalStorageImport {
  readonly importId: string
  readonly entries: Readonly<Record<string, string>>
}

export interface ElectronMigrationReport {
  readonly state: MigrationState
  /** Present until the renderer acknowledges it; hand it to the first window's preload. */
  readonly localStorageImport?: PendingLocalStorageImport
}

async function exists(target: string) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function localStorageDirectory(userData: string) {
  const candidates = [
    path.join(userData, ELECTRON_SESSION_DATA_DIRECTORY, 'Local Storage', 'leveldb'),
    // Before session-data (Electron's default profile layout directly under userData).
    path.join(userData, 'Local Storage', 'leveldb'),
  ]
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, 'CURRENT'))) return candidate
  }
  return undefined
}

async function runLocalStorageStep(options: ElectronMigrationOptions, state: MigrationState) {
  const now = options.now?.() ?? new Date()
  if (state.steps['local-storage'].status === 'awaiting-renderer') {
    const exported = await readLocalStorageExport(options.userData)
    if (exported) return { state, pending: exported }
  }
  const directory = await localStorageDirectory(options.userData)
  if (!directory) {
    return { state: withStep(state, 'local-storage', { status: 'not-needed' }, now, true) }
  }
  const snapshot = await readElectronLocalStorage({
    levelDbDirectory: directory,
    origin: options.rendererOrigin ?? ELECTRON_RENDERER_ORIGIN,
  })
  const pending = { importId: randomUUID(), entries: snapshot.entries }
  await writeLocalStorageExport(options.userData, pending)
  const detail = {
    entries: Object.keys(snapshot.entries).length,
    undecodable: snapshot.undecodable,
  }
  return {
    state: withStep(state, 'local-storage', { status: 'awaiting-renderer', detail }, now, true),
    pending,
  }
}

async function runSecretsStep(options: ElectronMigrationOptions, state: MigrationState) {
  const now = options.now?.() ?? new Date()
  try {
    const files = await migrateSecretFiles(options.codec, {
      userData: options.userData,
      sharedMcpDirectory: options.sharedMcpDirectory,
    })
    const status = files.length === 0 ? 'not-needed' : 'done'
    return withStep(state, 'secrets', { status, detail: { files } }, now, true)
  } catch (error) {
    if (error instanceof SafeStorageDecryptError && error.reason === 'key-unavailable') {
      return withStep(state, 'secrets', { status: 'blocked', error: message(error) }, now, true)
    }
    throw error
  }
}

async function runPreviewResetStep(options: ElectronMigrationOptions, state: MigrationState) {
  const now = options.now?.() ?? new Date()
  const partitions = path.join(options.userData, ELECTRON_SESSION_DATA_DIRECTORY, 'Partitions')
  let names: string[] = []
  try {
    names = await readdir(partitions)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const removed = names.filter((name) => name.startsWith(BROWSER_PREVIEW_PARTITION_PREFIX))
  for (const name of removed) {
    await rm(path.join(partitions, name), { recursive: true, force: true })
  }
  const status = removed.length === 0 ? 'not-needed' : 'done'
  return withStep(state, 'browser-preview-reset', { status, detail: { removed } }, now, true)
}

/**
 * What only Electron's Chromium leaves in a profile, under `session-data` or (before it) the
 * profile root. The Electrobun build creates `session-data` too, so the directory proves nothing.
 */
const ELECTRON_PROFILE_MARKERS = ['Local State', 'Preferences', 'Local Storage', 'Partitions']

async function hasElectronProfile(userData: string) {
  const roots = [path.join(userData, ELECTRON_SESSION_DATA_DIRECTORY), userData]
  const found = await Promise.all(
    roots.flatMap((root) =>
      ELECTRON_PROFILE_MARKERS.map((marker) => exists(path.join(root, marker))),
    ),
  )
  return found.includes(true)
}

async function initialState(options: ElectronMigrationOptions) {
  const existing = await readMigrationState(options.userData)
  if (existing) return existing
  const fromElectron = await hasElectronProfile(options.userData)
  const state = initialMigrationState(options.now?.() ?? new Date(), fromElectron)
  await writeMigrationState(options.userData, state)
  options.log?.('Electron migration state created', { fromElectron })
  return state
}

async function runStep(
  options: ElectronMigrationOptions,
  state: MigrationState,
  step: MigrationStep,
) {
  if (step === 'local-storage') return runLocalStorageStep(options, state)
  if (step === 'secrets') return { state: await runSecretsStep(options, state) }
  return { state: await runPreviewResetStep(options, state) }
}

interface StepOutcome {
  readonly state: MigrationState
  readonly pending?: PendingLocalStorageImport
}

async function runPendingStep(
  options: ElectronMigrationOptions,
  state: MigrationState,
  step: MigrationStep,
) {
  const current = state.steps[step]
  const selected = options.steps ?? MIGRATION_STEPS
  if (!selected.includes(step) || isStepFinal(current)) return undefined
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (current.status === 'failed' && current.attempts >= maxAttempts) return undefined
  try {
    return await runStep(options, state, step)
  } catch (error) {
    options.log?.('Electron migration step failed', { step, error: message(error) })
    const failed = { status: 'failed' as const, error: message(error) }
    const outcome: StepOutcome = {
      state: withStep(state, step, failed, options.now?.() ?? new Date(), true),
    }
    return outcome
  }
}

/** Runs every step that is not final yet. Never throws for a failed step; the state records it. */
export function runElectronMigration(options: ElectronMigrationOptions) {
  return options.withLock(async () => {
    let state = await initialState(options)
    if (state.completedAt) {
      const report: ElectronMigrationReport = { state }
      return report
    }
    let localStorageImport: PendingLocalStorageImport | undefined
    for (const step of MIGRATION_STEPS) {
      const outcome = await runPendingStep(options, state, step)
      if (!outcome) continue
      state = outcome.state
      localStorageImport = outcome.pending ?? localStorageImport
      await writeMigrationState(options.userData, state)
      options.log?.('Electron migration step finished', { step, status: state.steps[step].status })
    }
    const report: ElectronMigrationReport = {
      state,
      ...(localStorageImport ? { localStorageImport } : {}),
    }
    return report
  })
}

/** The renderer applied the import: mark the step done and drop the exported copy. */
export function acknowledgeLocalStorageImport(
  options: Pick<ElectronMigrationOptions, 'userData' | 'withLock' | 'now'>,
  importId: string,
) {
  return options.withLock(async () => {
    const [state, exported] = await Promise.all([
      readMigrationState(options.userData),
      readLocalStorageExport(options.userData),
    ])
    if (state?.steps['local-storage'].status !== 'awaiting-renderer') return state
    if (exported?.importId !== importId) return state
    const detail = state.steps['local-storage'].detail
    const next = withStep(
      state,
      'local-storage',
      { status: 'done', detail },
      options.now?.() ?? new Date(),
      false,
    )
    await writeMigrationState(options.userData, next)
    await removeLocalStorageExport(options.userData)
    return next
  })
}

/**
 * The user will enter a step's data again ("Skip, I'll enter them again"): the step becomes final
 * if it was not, and its detail records the choice, so nothing asks about it again.
 */
export function skipMigrationStep(
  options: Pick<ElectronMigrationOptions, 'userData' | 'withLock' | 'now'>,
  step: MigrationStep,
) {
  return options.withLock(async () => {
    const state = await readMigrationState(options.userData)
    if (!state) return state
    const current = state.steps[step]
    const skipped = {
      status: isStepFinal(current) ? current.status : ('not-needed' as const),
      detail: { ...(isObjectValue(current.detail) ? current.detail : {}), skippedByUser: true },
    }
    const next = withStep(state, step, skipped, options.now?.() ?? new Date(), false)
    await writeMigrationState(options.userData, next)
    return next
  })
}
