import { describe, expect, it } from 'vitest'
import {
  snapshotWindowsTreeFromRecords,
  type WindowsProcessRecord,
  windowsTreeSnapshotExited,
} from '../windows-process-tree'

function processRecord(
  processId: number,
  parentProcessId: number,
  creationDate = `created-${String(processId)}`,
) {
  return { processId, parentProcessId, creationDate } satisfies WindowsProcessRecord
}

describe('Windows process-tree identity proof', () => {
  it('retains descendant identity after its root exits and it is reparented', () => {
    const snapshot = snapshotWindowsTreeFromRecords(42, [
      processRecord(43, 42),
      processRecord(44, 43),
    ])

    expect(
      windowsTreeSnapshotExited(snapshot, [
        processRecord(43, 1),
        processRecord(44, 43),
      ]),
    ).toBe(false)
  })

  it('does not mistake PID reuse for a surviving captured process', () => {
    const snapshot = snapshotWindowsTreeFromRecords(42, [
      processRecord(42, 1),
      processRecord(43, 42),
    ])

    expect(windowsTreeSnapshotExited(snapshot, [processRecord(43, 1, 'reused-pid')])).toBe(
      true,
    )
  })
})
