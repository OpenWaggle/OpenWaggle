import { processRole, processTree, profileHostPids, sampleProcesses } from './perf-processes'

const BYTES_PER_MEGABYTE = 1_048_576

/** Footprint and resident size of the GUI tree plus the profile's Host tree, by process role. */
export function sampleAppMemory(guiPid: number | undefined, userData: string) {
  const roots = [...(guiPid === undefined ? [] : [guiPid]), ...profileHostPids(userData)]
  const tree = processTree(roots)
  const samples = sampleProcesses(tree.map((entry) => entry.pid))
  const byRole: Record<string, { count: number; footprintMb: number; residentMb: number }> = {}
  let footprint = 0
  let resident = 0
  let cpuNs = 0
  for (const entry of tree) {
    const sample = samples.get(entry.pid)
    if (!sample) continue
    const role = processRole(entry.command)
    const totals = (byRole[role] ??= { count: 0, footprintMb: 0, residentMb: 0 })
    totals.count += 1
    totals.footprintMb += sample.footprint / BYTES_PER_MEGABYTE
    totals.residentMb += sample.resident / BYTES_PER_MEGABYTE
    footprint += sample.footprint
    resident += sample.resident
    cpuNs += sample.cpuNs
  }
  for (const totals of Object.values(byRole)) {
    totals.footprintMb = Math.round(totals.footprintMb)
    totals.residentMb = Math.round(totals.residentMb)
  }
  return {
    at: Date.now(),
    processCount: tree.length,
    footprintMb: Math.round(footprint / BYTES_PER_MEGABYTE),
    residentMb: Math.round(resident / BYTES_PER_MEGABYTE),
    cpuNs,
    byRole,
  }
}

export type AppMemorySample = ReturnType<typeof sampleAppMemory>
