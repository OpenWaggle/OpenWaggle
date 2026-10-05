import type { UpdateStatus } from '@shared/types/updater'
import { broadcastToWindows } from './utils/broadcast'

export type DownloadedUpdateStatus = Extract<UpdateStatus, { readonly type: 'downloaded' }>

let currentStatus: UpdateStatus = { type: 'idle' }

/** The updater's status, broadcast to every window on change. */
export function setUpdateStatus(status: UpdateStatus) {
  currentStatus = status
  broadcastToWindows('updater:status-changed', status)
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus
}

export function setUpdateWaitingForRuns(activeRuns: number | null) {
  if (currentStatus.type !== 'downloaded') return
  const { waitingForRuns: _previous, ...downloaded } = currentStatus
  setUpdateStatus(activeRuns === null ? downloaded : { ...downloaded, waitingForRuns: activeRuns })
}
