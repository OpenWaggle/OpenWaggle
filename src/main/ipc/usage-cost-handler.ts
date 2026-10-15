import os from 'node:os'
import { safeDecodeUnknown } from '@shared/schema'
import { usageCostQuerySchema, usageCostSessionQuerySchema } from '@shared/schemas/usage-cost'
import type { UsageCostQuery, UsageCostSessionQuery } from '@shared/types/usage-cost'
import * as Effect from 'effect/Effect'
import { createPiUsageCostScanner } from '../adapters/pi/usage-cost/pi-usage-cost-scanner'
import {
  createUsageCostService,
  type UsageCostServiceContext,
} from '../application/usage-cost-service'
import { SettingsService } from '../services/settings-service'
import { typedHandle } from './typed-ipc'

/** One scanner instance for the app: the per-file `(size, mtime)` cache is instance state. */
let defaultScanner: ReturnType<typeof createPiUsageCostScanner> | null = null

function scanner() {
  defaultScanner ??= createPiUsageCostScanner()
  return defaultScanner
}

function decodeQuery(value: unknown): UsageCostQuery {
  const decoded = safeDecodeUnknown(usageCostQuerySchema, value)
  if (!decoded.success) throw new Error(decoded.issues.join('; '))
  return decoded.data
}

function decodeSessionQuery(value: unknown): UsageCostSessionQuery {
  const decoded = safeDecodeUnknown(usageCostSessionQuerySchema, value)
  if (!decoded.success) throw new Error(decoded.issues.join('; '))
  return decoded.data
}

/**
 * Display context for the view: home-abbreviation, temporary roots, project
 * display names, and the projects a cwd may sit inside. Falls back to safe
 * defaults when settings cannot be read so the view still works.
 */
function serviceContextEffect() {
  const defaults: UsageCostServiceContext = {
    homePath: os.homedir(),
    temporaryRoots: ['/private/tmp', '/tmp', os.tmpdir()],
    displayNames: {},
    knownProjects: [],
  }
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get().pipe(Effect.orElseSucceed(() => null))
    if (settings === null) return defaults
    const knownProjects = [settings.projectPath, ...settings.recentProjects].filter(
      (projectPath): projectPath is string => typeof projectPath === 'string' && projectPath !== '',
    )
    return { ...defaults, displayNames: settings.projectDisplayNames, knownProjects }
  })
}

export function registerUsageCostHandlers(): void {
  typedHandle('usage-cost:get-view', (_event, query: unknown) =>
    Effect.gen(function* () {
      const decoded = decodeQuery(query)
      const context = yield* serviceContextEffect()
      return yield* Effect.tryPromise(() =>
        createUsageCostService(scanner(), context).getView(decoded),
      )
    }),
  )

  typedHandle('usage-cost:get-sessions', (_event, query: unknown) =>
    Effect.gen(function* () {
      const decoded = decodeSessionQuery(query)
      const context = yield* serviceContextEffect()
      return yield* Effect.tryPromise(() =>
        createUsageCostService(scanner(), context).getSessions(decoded),
      )
    }),
  )
}
