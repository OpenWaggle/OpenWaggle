import { parseJsonUnknown, safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema } from '@shared/schemas/waggle'
import { createWaggleModelBinding, type WaggleConfig } from '@shared/types/waggle'

export function parseJsonValue(raw: string | null) {
  if (raw === null) {
    return undefined
  }
  return parseJsonUnknown(raw)
}

export function normalizeModelId(raw: string) {
  const trimmed = raw.trim()
  if (trimmed) {
    return trimmed
  }
  return undefined
}

export function hydrateWaggleConfig(raw: unknown) {
  if (raw === undefined) {
    return undefined
  }

  const parsed = safeDecodeUnknown(waggleConfigSchema, raw)
  if (!parsed.success) {
    return undefined
  }

  return {
    ...parsed.data,
    agents: [
      {
        ...parsed.data.agents[0],
        model: createWaggleModelBinding(parsed.data.agents[0].model),
      },
      {
        ...parsed.data.agents[1],
        model: createWaggleModelBinding(parsed.data.agents[1].model),
      },
    ],
  } satisfies WaggleConfig
}
