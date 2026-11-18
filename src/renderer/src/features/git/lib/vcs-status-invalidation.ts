import type { WorkingPath } from '@shared/types/brand'

type VcsStatusReader = () => Promise<void>

const readersByPath = new Map<string, Set<VcsStatusReader>>()

/** Registers one VCS status consumer to re-read when its working tree is invalidated. */
export function subscribeVcsStatusInvalidation(workingPath: WorkingPath, read: VcsStatusReader) {
  const key = String(workingPath)
  const readers = readersByPath.get(key) ?? new Set<VcsStatusReader>()
  readers.add(read)
  readersByPath.set(key, readers)
  return () => {
    readers.delete(read)
    if (readers.size === 0) readersByPath.delete(key)
  }
}

/**
 * Re-reads VCS status in every surface that shows it for one working tree (Session Summary, Diff
 * panel, Change request composer). A source-control fix made in one panel otherwise left the
 * others on their old answer until their next routine refresh. Resolves once all have re-read.
 */
export async function invalidateVcsStatus(workingPath: WorkingPath) {
  const readers = [...(readersByPath.get(String(workingPath)) ?? [])]
  await Promise.all(readers.map((read) => read()))
}
