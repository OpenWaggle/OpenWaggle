import { match, P } from '@diegogbrisa/ts-match'

const MAX_DISCOVERY_TEXT_LENGTH = 12_000

export interface SessionDiscoveryDocumentSource {
  readonly session_id: string
  readonly title: string
  readonly specification_json: string | null
  readonly initial_content_json: string | null
  readonly preview_content_json: string | null
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

function visiblePartStrings(part: unknown) {
  return match(part)
    .with({ type: 'text', text: P.select('value', P.string) }, ({ value }) => {
      const normalized = optionalString(value)
      return normalized ? [normalized] : []
    })
    .with(
      { type: 'attachment', attachment: { name: P.select('value', P.string) } },
      { type: 'tool-call', toolCall: { name: P.select('value', P.string) } },
      { type: 'tool-result', toolResult: { name: P.select('value', P.string) } },
      ({ value }) => {
        const normalized = optionalString(value)
        return normalized ? [normalized] : []
      },
    )
    .otherwise(() => [])
}

function messageDiscoveryStrings(value: string | null) {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return match(parsed)
      .with({ text: P.select('text', P.string) }, ({ text }) => {
        const normalized = optionalString(text)
        return normalized ? [normalized] : []
      })
      .with({ parts: P.select('parts', P.array(P._)) }, ({ parts }) =>
        parts.flatMap(visiblePartStrings),
      )
      .otherwise(() => [])
  } catch {
    return []
  }
}

export function sessionDiscoveryDocument(row: SessionDiscoveryDocumentSource) {
  return [
    row.title.trim(),
    ...delegationObjective(row.specification_json),
    ...messageDiscoveryStrings(row.initial_content_json),
    ...messageDiscoveryStrings(row.preview_content_json),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_DISCOVERY_TEXT_LENGTH)
}
