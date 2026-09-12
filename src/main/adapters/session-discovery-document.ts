import { match, P } from '@diegogbrisa/ts-match'

const MAX_DISCOVERY_TEXT_LENGTH = 12_000

export interface SessionDiscoveryDocumentSource {
  readonly session_id: string
  readonly title: string
  readonly specification_json: string | null
  readonly initial_text: string | null
  readonly preview_text: string | null
  readonly queued_at: number
}

function delegationObjective(value: string | null) {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return match(parsed)
      .with({ objective: P.select('objective', P.string) }, ({ objective }) => {
        const normalized = optionalString(objective)
        return normalized ? [normalized] : []
      })
      .otherwise(() => [])
  } catch {
    return []
  }
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function sessionDiscoveryDocument(row: SessionDiscoveryDocumentSource) {
  return [
    row.title.trim(),
    ...delegationObjective(row.specification_json),
    optionalString(row.initial_text),
    optionalString(row.preview_text),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_DISCOVERY_TEXT_LENGTH)
}
