import { TERMINAL } from '@shared/constants/resource-limits'
import type {
  TerminalActivitySnapshot,
  TerminalActivityStatus,
  TerminalActivitySummary,
  TerminalRuntimeEvent,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import { createLogger } from '../../logger'
import type { TerminalRecord } from './terminal-records'

const logger = createLogger('terminal-activity-snapshot')

/** Output batches never mutate the record fields projected by this transport. */
export function terminalEventCanChangeActivitySummary(event: TerminalRuntimeEvent) {
  return event.type !== 'output'
}

/**
 * Only a successful descendant observation can report `running`. An empty but
 * unreliable probe remains unknown, which keeps Project Action terminal reuse
 * conservative while the inspector is starting or temporarily unavailable.
 */
export function terminalActivityStatus(record: TerminalRecord): TerminalActivityStatus {
  if (record.live === null) {
    return record.exitCode === null && !record.closed ? 'unknown' : 'idle'
  }
  if (record.activity?.processReliable !== true) return 'unknown'
  return record.activity.processNames.length > 0 ? 'running' : 'idle'
}

const STATUS_PRIORITY: Record<TerminalActivityStatus, number> = {
  idle: 0,
  unknown: 1,
  running: 2,
}

function compareSummaries(left: TerminalActivitySummary, right: TerminalActivitySummary) {
  if (left.projectActionPending !== right.projectActionPending) {
    return left.projectActionPending ? -1 : 1
  }
  const leftIsRunning = left.activityStatus === 'running'
  const rightIsRunning = right.activityStatus === 'running'
  if (leftIsRunning !== rightIsRunning) return leftIsRunning ? -1 : 1
  const ownerOrder = left.ownerKey.localeCompare(right.ownerKey)
  return ownerOrder === 0 ? left.terminalId.localeCompare(right.terminalId) : ownerOrder
}

function mergeSummary(
  existing: TerminalActivitySummary,
  candidate: TerminalActivitySummary,
): TerminalActivitySummary {
  const preferred =
    STATUS_PRIORITY[candidate.activityStatus] > STATUS_PRIORITY[existing.activityStatus]
      ? candidate
      : existing
  const processName =
    [existing.processName, candidate.processName]
      .filter((value): value is string => value !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null
  const ports = [...new Set([...existing.ports, ...candidate.ports])].sort(
    (left, right) => left - right,
  )
  const portPreviews = [...(existing.portPreviews ?? []), ...(candidate.portPreviews ?? [])]
    .filter(
      (preview, index, previews) =>
        previews.findIndex((candidatePreview) => candidatePreview.url === preview.url) === index,
    )
    .sort((left, right) => left.port - right.port || left.host.localeCompare(right.host))
  const merged = {
    ...preferred,
    processName,
    ports,
    projectActionPending: existing.projectActionPending || candidate.projectActionPending,
  }
  return portPreviews.length === 0 ? merged : { ...merged, portPreviews }
}

export function projectTerminalActivitySnapshot(
  records: Iterable<TerminalRecord>,
  revision: number,
): TerminalActivitySnapshot {
  const summariesByKey = new Map<string, TerminalActivitySummary>()
  for (const record of records) {
    const portPreviews = record.activity?.portPreviews ?? []
    const summary: TerminalActivitySummary = {
      ownerKey: record.ownerKey,
      terminalId: record.terminalId,
      activityStatus: terminalActivityStatus(record),
      processName: record.activity?.processName ?? null,
      ports: record.activity?.ports ?? [],
      ...(portPreviews.length === 0 ? {} : { portPreviews }),
      projectActionPending: record.projectAction !== null && record.projectAction !== undefined,
    }
    const key = terminalKeyOf(summary.ownerKey, summary.terminalId)
    const existing = summariesByKey.get(key)
    summariesByKey.set(key, existing === undefined ? summary : mergeSummary(existing, summary))
  }
  const all = [...summariesByKey.values()].sort(compareSummaries)
  return {
    revision,
    summaries: all.slice(0, TERMINAL.ACTIVITY_SUMMARY_LIMIT),
    truncated: all.length > TERMINAL.ACTIVITY_SUMMARY_LIMIT,
  }
}

/** Compare only transport content; the revision is assigned after a real change. */
export function sameTerminalActivitySnapshotContent(
  left: TerminalActivitySnapshot,
  right: TerminalActivitySnapshot,
) {
  if (left.truncated !== right.truncated || left.summaries.length !== right.summaries.length) {
    return false
  }
  return left.summaries.every((summary, index) => {
    const candidate = right.summaries[index]
    return (
      candidate !== undefined &&
      summary.ownerKey === candidate.ownerKey &&
      summary.terminalId === candidate.terminalId &&
      summary.activityStatus === candidate.activityStatus &&
      summary.processName === candidate.processName &&
      summary.projectActionPending === candidate.projectActionPending &&
      summary.ports.length === candidate.ports.length &&
      summary.ports.every((port, portIndex) => port === candidate.ports[portIndex]) &&
      (summary.portPreviews?.length ?? 0) === (candidate.portPreviews?.length ?? 0) &&
      (summary.portPreviews ?? []).every(
        (preview, previewIndex) =>
          preview.host === candidate.portPreviews?.[previewIndex]?.host &&
          preview.port === candidate.portPreviews?.[previewIndex]?.port &&
          preview.url === candidate.portPreviews?.[previewIndex]?.url,
      )
    )
  })
}

export function makeTerminalActivitySnapshotPublisher(
  records: () => Iterable<TerminalRecord>,
  onChanged?: (snapshot: TerminalActivitySnapshot) => void,
) {
  let revision = 0
  let latest: TerminalActivitySnapshot = { revision, summaries: [], truncated: false }

  const refresh = (notify: boolean) => {
    const candidate = projectTerminalActivitySnapshot(records(), revision)
    if (sameTerminalActivitySnapshotContent(candidate, latest)) return latest
    revision += 1
    latest = { ...candidate, revision }
    if (notify) {
      try {
        onChanged?.(latest)
      } catch (error) {
        logger.warn('Terminal activity metadata listener failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return latest
  }

  return {
    getSnapshot: () => refresh(true),
    notify: () => {
      refresh(true)
    },
  }
}
