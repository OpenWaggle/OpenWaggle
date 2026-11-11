import { match } from '@diegogbrisa/ts-match'
import type { ElectronMigrationNotice } from '@shared/types/electron-migration'
import {
  type ElectronLocalStorageImport,
  electronLocalStorageImportRendererArguments,
} from '@shared/utils/electron-local-storage-import'
import {
  acknowledgeElectrobunLocalStorageImport,
  runElectrobunFirstLaunchMigration,
  skipElectrobunMigrationStep,
} from '../adapters/electrobun/electrobun-electron-migration'
import { appLifecycle } from '../desktop-shell/app-lifecycle'
import { createLogger } from '../logger'
import { describeError } from '../utils/describe-error'
import type { ElectronMigrationReport } from './electron-migrator'
import { MIGRATION_STEPS, type MigrationState, type MigrationStepState } from './migration-state'

/**
 * The first launch after the Electron build, in the window's process
 * (docs/electrobun-transition.md). It starts at ready, beside the Session Host launch; the window
 * waits for it at most `WINDOW_WAIT_MS`, so the exported `localStorage` reaches the first window's
 * preload on the launch that exports it, and a slow export reaches the next launch instead.
 *
 * The secrets step reads the previous version's key from the keychain. A packaged build is signed
 * so that read is silent, and runs it with the others. An unpackaged macOS build would prompt, so
 * it waits for the user's Continue in the notice (`electronMigrationNotice`).
 */
const WINDOW_WAIT_MS = 1500

const logger = createLogger('electron-migration')

const state: {
  run: Promise<void> | null
  last: MigrationState | null
  pending: ElectronLocalStorageImport | null
  busy: boolean
} = { run: null, last: null, pending: null, busy: false }

function asksBeforeSecrets() {
  return process.platform === 'darwin' && !appLifecycle.isPackaged()
}

function automaticSteps() {
  return asksBeforeSecrets()
    ? MIGRATION_STEPS.filter((step) => step !== 'secrets')
    : MIGRATION_STEPS
}

function record(report: ElectronMigrationReport) {
  state.last = report.state
  state.pending = report.localStorageImport ?? null
}

/** Runs the steps that need no answer from the user; never throws. */
export function startFirstLaunchMigration() {
  state.run ??= runElectrobunFirstLaunchMigration({ steps: automaticSteps() }).then(
    record,
    (error: unknown) =>
      logger.warn('The first-launch migration did not run', { error: describeError(error) }),
  )
  return state.run
}

/**
 * Starts the migration beside the Host launch and waits a little for it, so its `localStorage`
 * import reaches the first window.
 */
export async function firstLaunchMigrationBeforeWindow() {
  const run = startFirstLaunchMigration()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, WINDOW_WAIT_MS)
  })
  await Promise.race([run, timeout]).finally(() => clearTimeout(timer))
}

/** The renderer arguments that hand a pending `localStorage` import to the window's preload. */
export function electronMigrationRendererArguments() {
  return electronLocalStorageImportRendererArguments(state.pending)
}

/** The preload applied the import; a lost acknowledgement re-sends it on the next launch. */
export async function acknowledgeFirstLaunchLocalStorageImport(importId: string) {
  if (state.pending?.importId !== importId) return
  state.pending = null
  const next = await acknowledgeElectrobunLocalStorageImport(importId)
  if (next) state.last = next
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}

function detailValue(step: MigrationStepState, key: string): unknown {
  return typeof step.detail === 'object' && step.detail !== null
    ? Reflect.get(step.detail, key)
    : undefined
}

/** The entries of the moved files that no key opened. */
function unrecoverableSecrets(step: MigrationStepState) {
  const files: unknown = detailValue(step, 'files')
  if (!Array.isArray(files)) return []
  return files.flatMap((file: unknown) =>
    typeof file === 'object' && file !== null ? stringList(Reflect.get(file, 'unrecoverable')) : [],
  )
}

function notice(
  secrets: ElectronMigrationNotice['secrets'],
  step: MigrationStepState,
  unrecoverable: readonly string[] = [],
): ElectronMigrationNotice {
  return { secrets, unrecoverable, error: step.error ?? null, busy: state.busy }
}

function noticeFor(migration: MigrationState | null): ElectronMigrationNotice | null {
  if (!migration?.fromElectron) return null
  const step = migration.steps.secrets
  if (detailValue(step, 'skippedByUser') === true) return null
  return match(step.status)
    .with('pending', () => (asksBeforeSecrets() ? notice('needs-consent', step) : null))
    .with('blocked', () => notice('blocked', step))
    .with('failed', () => notice('failed', step))
    .with('done', () => {
      const unrecoverable = unrecoverableSecrets(step)
      return unrecoverable.length > 0 ? notice('unrecoverable', step, unrecoverable) : null
    })
    .with('awaiting-renderer', 'not-needed', () => null)
    .exhaustive()
}

/** What the notice shows, or null when the user need not do anything. */
export async function electronMigrationNotice() {
  await state.run
  return noticeFor(state.last)
}

/** Continue (or Try again): runs only the secrets step, past the automatic attempt cap. */
export async function continueElectronSecretsMigration() {
  await state.run
  state.busy = true
  try {
    record(await runElectrobunFirstLaunchMigration({ steps: ['secrets'], userRequested: true }))
  } catch (error) {
    logger.warn('Moving the saved secrets failed', { error: describeError(error) })
  } finally {
    state.busy = false
  }
  return noticeFor(state.last)
}

/** Skip, I'll enter them again. */
export async function skipElectronSecretsMigration() {
  await state.run
  const next = await skipElectrobunMigrationStep('secrets')
  if (next) state.last = next
  return noticeFor(state.last)
}
