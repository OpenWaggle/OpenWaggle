import type { TerminalAttachResult, TerminalReadinessSnapshot } from '@shared/types/terminal'
import type { Dispatch, SetStateAction } from 'react'
import { useTerminalStore } from '../state/terminal-store'
import type { createTerminalOutputDelivery } from './terminal-output-delivery'

interface TerminalAttachSnapshotApplierOptions {
  readonly ownerKey: string
  readonly terminalId: string
  readonly outputDelivery: ReturnType<typeof createTerminalOutputDelivery>
  readonly setReadiness: Dispatch<SetStateAction<TerminalReadinessSnapshot | null>>
}

export function createTerminalAttachSnapshotApplier(options: TerminalAttachSnapshotApplierOptions) {
  return (snapshot: TerminalAttachResult) => {
    options.setReadiness(snapshot.readiness)
    options.outputDelivery.applySnapshot(snapshot)
    const terminalStore = useTerminalStore.getState()
    terminalStore.applyRuntimeEvent(options.ownerKey, options.terminalId, {
      type: 'activity',
      processName: snapshot.processName ?? null,
    })
    terminalStore.applyRuntimeEvent(options.ownerKey, options.terminalId, {
      type: 'ports',
      ports: snapshot.ports ?? [],
    })
    terminalStore.applyRuntimeEvent(options.ownerKey, options.terminalId, {
      type: 'port-previews',
      previews: snapshot.portPreviews ?? [],
    })
  }
}
