import { createHash } from 'node:crypto'
import type { Logger } from '@shared/types/logger'
import { type Mock, vi } from 'vitest'
import { MemoryMigrationFs } from './memory-migration-fs'

export const HOME = '/home/user'
export const PI_GLOBAL = `${HOME}/.pi/agent/mcp.json`
export const OPENWAGGLE_GLOBAL = `${HOME}/.openwaggle/mcp.json`
export const LEGACY_STATE = `${HOME}/.openwaggle/mcp/state.json`
export const MIGRATION_RECORD = `${HOME}/.openwaggle/mcp/migration.json`
export const NOW = new Date('2026-10-01T12:00:00.000Z')

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * The fingerprint the old importer stored in `provenance.fingerprint` for a
 * definition it normalized from `sourcePath`.
 */
export function oldFingerprint(sourcePath: string, name: string, normalized: unknown) {
  return sha256(['pi', sourcePath, name, sha256(canonicalJson(normalized))].join('\u0000'))
}

/** The old state.json key of a server defined in `filePath`. */
export function oldIdentityKey(filePath: string, name: string) {
  return sha256(`${filePath}\u0000${name}`)
}

/** An OpenWaggle copy exactly as the old importer wrote it. */
export function piCopy(sourcePath: string, name: string, normalized: Record<string, unknown>) {
  return {
    ...normalized,
    provenance: {
      source: 'pi',
      sourcePath,
      fingerprint: oldFingerprint(sourcePath, name, normalized),
      importedAt: '2026-08-11T19:37:37.600Z',
    },
  }
}

export function legacyState(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    globalState: 'off',
    projectStates: {},
    sessionStates: {},
    projectServerStates: {},
    servers: {},
    ...overrides,
  }
}

export interface RecordingLogger extends Logger {
  readonly error: Mock<Logger['error']>
}

export function recordingLogger(): RecordingLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn<Logger['error']>() }
}

export function memoryFs(files: Record<string, unknown>) {
  return new MemoryMigrationFs(
    Object.fromEntries(
      Object.entries(files).map(([filePath, value]) => [
        filePath,
        typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
      ]),
    ),
  )
}
