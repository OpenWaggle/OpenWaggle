import type { IpcEventPayload } from '@shared/types/ipc'
import {
  type SessionResourceInvalidation,
  subscribeToSessionResourceInvalidations,
} from '../application/session-resource-invalidation'
import { broadcastToWindows } from '../utils/broadcast'

let disposeBridge: (() => void) | null = null

export function registerSessionResourceInvalidationBridge(): void {
  disposeBridge?.()
  disposeBridge = subscribeToSessionResourceInvalidations((event: SessionResourceInvalidation) => {
    const payload = event satisfies IpcEventPayload<'sessions:resources-invalidated'>
    broadcastToWindows('sessions:resources-invalidated', payload)
  })
}

export function disposeSessionResourceInvalidationBridge(): void {
  disposeBridge?.()
  disposeBridge = null
}
