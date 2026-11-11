/**
 * `migration-state.json`: which first-launch migration steps from the Electron build have run.
 * Written atomically after every step, so a crash or a quit between steps resumes where it stopped.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MIGRATION_STATE_FILE = 'migration-state.json'
const STATE_VERSION = 1
const FILE_MODE = 0o600
const JSON_INDENT = 2

export const MIGRATION_STEPS = ['local-storage', 'secrets', 'browser-preview-reset'] as const
export type MigrationStep = (typeof MIGRATION_STEPS)[number]

export type MigrationStepStatus =
  | 'pending'
  /** localStorage was exported; the renderer applies it on its next start and acknowledges it. */
  | 'awaiting-renderer'
  /** A precondition outside the app is missing (a locked keychain, a refused prompt); retried. */
  | 'blocked'
  | 'failed'
  | 'done'
  /** Nothing to migrate for this step on this install. */
  | 'not-needed'

export interface MigrationStepState {
  readonly status: MigrationStepStatus
  readonly attempts: number
  readonly updatedAt: string
  readonly error?: string
  readonly detail?: unknown
}

export interface MigrationState {
  readonly version: typeof STATE_VERSION
  readonly createdAt: string
  readonly updatedAt: string
  /** True when userData held an Electron install's data on the first Electrobun launch. */
  readonly fromElectron: boolean
  readonly steps: Readonly<Record<MigrationStep, MigrationStepState>>
  readonly completedAt?: string
}

export class MigrationStateError extends Error {}

const FINAL_STATUSES: ReadonlySet<MigrationStepStatus> = new Set(['done', 'not-needed'])

export function isStepFinal(step: MigrationStepState) {
  return FINAL_STATUSES.has(step.status)
}

export function initialMigrationState(now: Date, fromElectron: boolean): MigrationState {
  const at = now.toISOString()
  const status: MigrationStepStatus = fromElectron ? 'pending' : 'not-needed'
  const step = { status, attempts: 0, updatedAt: at }
  const steps = { 'local-storage': step, secrets: step, 'browser-preview-reset': step }
  return {
    version: STATE_VERSION,
    createdAt: at,
    updatedAt: at,
    fromElectron,
    steps,
    ...(fromElectron ? {} : { completedAt: at }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const STATUSES: ReadonlySet<string> = new Set<MigrationStepStatus>([
  'pending',
  'awaiting-renderer',
  'blocked',
  'failed',
  'done',
  'not-needed',
])

function isStepStatus(value: unknown): value is MigrationStepStatus {
  return typeof value === 'string' && STATUSES.has(value)
}

function parseStep(value: unknown): MigrationStepState {
  if (
    !isRecord(value) ||
    !isStepStatus(value['status']) ||
    typeof value['attempts'] !== 'number' ||
    typeof value['updatedAt'] !== 'string'
  ) {
    throw new MigrationStateError('migration-state.json has an invalid step.')
  }
  return {
    status: value['status'],
    attempts: value['attempts'],
    updatedAt: value['updatedAt'],
    ...(typeof value['error'] === 'string' ? { error: value['error'] } : {}),
    ...(value['detail'] === undefined ? {} : { detail: value['detail'] }),
  }
}

export function parseMigrationState(raw: string): MigrationState {
  const parsed: unknown = JSON.parse(raw)
  if (
    !isRecord(parsed) ||
    parsed['version'] !== STATE_VERSION ||
    typeof parsed['createdAt'] !== 'string' ||
    typeof parsed['updatedAt'] !== 'string' ||
    typeof parsed['fromElectron'] !== 'boolean' ||
    !isRecord(parsed['steps'])
  ) {
    throw new MigrationStateError('migration-state.json has an unsupported format.')
  }
  const steps = parsed['steps']
  return {
    version: STATE_VERSION,
    createdAt: parsed['createdAt'],
    updatedAt: parsed['updatedAt'],
    fromElectron: parsed['fromElectron'],
    steps: {
      'local-storage': parseStep(steps['local-storage']),
      secrets: parseStep(steps['secrets']),
      'browser-preview-reset': parseStep(steps['browser-preview-reset']),
    },
    ...(typeof parsed['completedAt'] === 'string' ? { completedAt: parsed['completedAt'] } : {}),
  }
}

export async function readMigrationState(userData: string) {
  try {
    return parseMigrationState(await readFile(path.join(userData, MIGRATION_STATE_FILE), 'utf8'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

export async function writeMigrationState(userData: string, state: MigrationState) {
  await mkdir(userData, { recursive: true })
  const target = path.join(userData, MIGRATION_STATE_FILE)
  const temporary = `${target}.${randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, JSON_INDENT)}\n`, { mode: FILE_MODE })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export function withStep(
  state: MigrationState,
  step: MigrationStep,
  next: Omit<MigrationStepState, 'attempts' | 'updatedAt'>,
  now: Date,
  countsAsAttempt: boolean,
): MigrationState {
  const at = now.toISOString()
  const previous = state.steps[step]
  const steps = {
    ...state.steps,
    [step]: {
      ...next,
      attempts: previous.attempts + (countsAsAttempt ? 1 : 0),
      updatedAt: at,
    },
  }
  const complete = Object.values(steps).every(isStepFinal)
  return {
    version: state.version,
    createdAt: state.createdAt,
    fromElectron: state.fromElectron,
    steps,
    updatedAt: at,
    ...(complete ? { completedAt: state.completedAt ?? at } : {}),
  }
}
