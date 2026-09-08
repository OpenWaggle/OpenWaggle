import os from 'node:os'
import type { TerminalPortPreview } from '@shared/types/terminal'
import {
  commonDevPortCandidates,
  normalizeTerminalListenerHost,
  type TerminalPortCandidate,
  TerminalPortPreviewProber,
  type VerifiedTerminalPortPreview,
} from './terminal-port-preview-probes'
import { runTerminalProcessCommand } from './terminal-process-command'
import { readWindowsTerminalListeners } from './terminal-windows-telemetry'

export interface TerminalListeningPortScan {
  readonly candidates: readonly TerminalPortCandidate[]
  readonly portsByPid: Map<number, number[]>
}

interface TerminalPortPreviewSnapshot {
  readonly listenerDiscoveryAvailable: boolean
  readonly previews: readonly VerifiedTerminalPortPreview[]
}

const previewProber = new TerminalPortPreviewProber()
const MAX_TCP_PORT_EXCLUSIVE = 65_536
const WINDOWS_LISTENER_FIELD_COUNT = 3
let latestPreviewSnapshot: TerminalPortPreviewSnapshot = {
  listenerDiscoveryAvailable: true,
  previews: [],
}

function recordListener(
  scan: { candidates: TerminalPortCandidate[]; portsByPid: Map<number, number[]> },
  pid: number,
  rawEndpoint: string,
) {
  const endpoint = parseListeningEndpoint(rawEndpoint)
  if (endpoint === null || !Number.isInteger(pid) || pid <= 0) return
  const ports = scan.portsByPid.get(pid) ?? []
  if (!ports.includes(endpoint.port)) ports.push(endpoint.port)
  scan.portsByPid.set(pid, ports)
  if (
    !scan.candidates.some(
      (candidate) =>
        candidate.pid === pid &&
        candidate.host === endpoint.host &&
        candidate.port === endpoint.port,
    )
  ) {
    scan.candidates.push({ ...endpoint, pid })
  }
}

export function parseListeningEndpoint(rawEndpoint: string) {
  const endpoint = rawEndpoint.split(' ', 1)[0]?.trim() ?? ''
  const separator = endpoint.lastIndexOf(':')
  if (separator < 0) return null
  const host = normalizeTerminalListenerHost(endpoint.slice(0, separator))
  const port = Number(endpoint.slice(separator + 1))
  if (host === null || !Number.isInteger(port) || port <= 0 || port >= MAX_TCP_PORT_EXCLUSIVE)
    return null
  return { host, port }
}

export function parseWindowsListeningPortOutput(raw: string): TerminalListeningPortScan {
  const scan = { candidates: [], portsByPid: new Map<number, number[]>() }
  for (const line of raw.split(/\r?\n/g)) {
    const [host, port, pid] = line.trim().split('|', WINDOWS_LISTENER_FIELD_COUNT)
    if (host === undefined || port === undefined) continue
    const authority = host.includes(':') ? `[${host}]` : host
    recordListener(scan, Number(pid), `${authority}:${port}`)
  }
  return scan
}

export function parsePosixListeningPortOutput(raw: string): TerminalListeningPortScan {
  const scan = { candidates: [], portsByPid: new Map<number, number[]>() }
  let pid: number | null = null
  for (const line of raw.split('\n')) {
    const tag = line.charAt(0)
    const value = line.slice(1)
    if (tag === 'p') {
      const parsed = Number(value)
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : null
      continue
    }
    if (tag !== 'n' || pid === null) continue
    recordListener(scan, pid, value)
  }
  return scan
}

async function readWindowsListeningPortScan() {
  const rows = await readWindowsTerminalListeners()
  if (rows === null) return null
  const scan = { candidates: [], portsByPid: new Map<number, number[]>() }
  for (const row of rows) {
    const authority = row.host.includes(':') ? `[${row.host}]` : row.host
    recordListener(scan, row.pid, `${authority}:${row.port}`)
  }
  return scan
}

async function readPosixListeningPortScan(processPids: readonly number[] | undefined) {
  if (processPids?.length === 0) {
    return { candidates: [], portsByPid: new Map<number, number[]>() }
  }
  const processFilter =
    processPids === undefined ? [] : ['-a', '-p', [...new Set(processPids)].join(',')]
  const result = await runTerminalProcessCommand('lsof', [
    '-nP',
    ...processFilter,
    '-iTCP',
    '-sTCP:LISTEN',
    '-F',
    'pn',
  ])
  // lsof exits 1 when the requested process set owns no listening sockets.
  if (!result.ok && result.exitCode !== 1) return null
  return parsePosixListeningPortOutput(result.output)
}

export function terminalPortCandidatesForScan(
  scan: TerminalListeningPortScan | null,
): readonly TerminalPortCandidate[] {
  return scan === null ? commonDevPortCandidates() : scan.candidates
}

async function updateTerminalPortPreviews(scan: TerminalListeningPortScan | null) {
  latestPreviewSnapshot = {
    listenerDiscoveryAvailable: scan !== null,
    previews: await previewProber.probe(terminalPortCandidatesForScan(scan)),
  }
}

/**
 * Reads raw listeners for close safety and classifies browser-loadable endpoints
 * in the same bounded scan. A missing socket-table tool falls back to common dev ports.
 */
export async function readListeningPorts(
  processPids?: readonly number[],
): Promise<Map<number, number[]> | null> {
  const scan =
    os.platform() === 'win32'
      ? await readWindowsListeningPortScan()
      : await readPosixListeningPortScan(processPids)
  await updateTerminalPortPreviews(scan)
  return scan?.portsByPid ?? null
}

/** Returns the latest verified URLs without exposing fallback sockets as close-safety evidence. */
export function terminalPortPreviewsForProcessPids(
  processPids: readonly number[],
): readonly TerminalPortPreview[] {
  const processIds = new Set(processPids)
  const visible = latestPreviewSnapshot.listenerDiscoveryAvailable
    ? latestPreviewSnapshot.previews.filter(
        (preview) => preview.pid !== null && processIds.has(preview.pid),
      )
    : latestPreviewSnapshot.previews
  const seen = new Set<string>()
  return visible.flatMap((preview) => {
    if (seen.has(preview.url)) return []
    seen.add(preview.url)
    return [{ host: preview.host, port: preview.port, url: preview.url }]
  })
}
