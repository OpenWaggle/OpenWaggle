import { safeDecodeUnknown } from '@shared/schema'
import { usageCostQuerySchema, usageCostSessionQuerySchema } from '@shared/schemas/usage-cost'
import type { UsageCostQuery, UsageCostSessionQuery } from '@shared/types/usage-cost'
import * as Effect from 'effect/Effect'
import { createPiUsageCostScanner } from '../adapters/pi/usage-cost/pi-usage-cost-scanner'
import { createUsageCostService } from '../application/usage-cost-service'
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

export function registerUsageCostHandlers(): void {
  typedHandle('usage-cost:get-view', (_event, query: unknown) =>
    Effect.tryPromise(async () => {
      const decoded = decodeQuery(query)
      return createUsageCostService(scanner()).getView(decoded)
    }),
  )

  typedHandle('usage-cost:get-sessions', (_event, query: unknown) =>
    Effect.tryPromise(async () => {
      const decoded = decodeSessionQuery(query)
      return createUsageCostService(scanner()).getSessions(decoded)
    }),
  )
}
