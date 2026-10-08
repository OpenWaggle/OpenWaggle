import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import { type CliResult, runCli } from './cli-runner'

/** Repository-scoped gh runners: reads may switch accounts, writes never do. */
export interface GhRunners {
  readonly run?: (args: readonly string[], cwd: string) => Promise<CliResult>
  readonly runWrite?: (args: readonly string[], cwd: string) => Promise<CliResult>
}

export function runGh(dependencies: GhRunners, args: readonly string[], projectPath: string) {
  return dependencies.run ? dependencies.run(args, projectPath) : runCli('gh', args, projectPath)
}

/** A create or merge command: run once, never retried as another account. */
export function runGhWrite(dependencies: GhRunners, args: readonly string[], projectPath: string) {
  // Never falls back to the retrying read runner: a write must not run as another account.
  return dependencies.runWrite
    ? dependencies.runWrite(args, projectPath)
    : runCli('gh', args, projectPath)
}

export function jsonStringProperty(raw: unknown, property: string): string | null {
  const decoded = safeDecodeUnknown(jsonObjectSchema, raw)
  if (!decoded.success) return null
  const value = decoded.data[property]
  return typeof value === 'string' ? value : null
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
