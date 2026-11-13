import { useEffect } from 'react'
import { api } from '@/shared/lib/ipc'
import {
  ensureBrowserEngine,
  setBrowserEngineStatus,
  useBrowserEngineStore,
} from '../state/browser-engine-store'

/**
 * Whether the Browser preview's engine is installed. Mounting a preview starts the install when it
 * is missing and follows its progress, which the viewport shows until the preview can open.
 */
export function useBrowserEngineReady(): boolean {
  const ready = useBrowserEngineStore((state) => state.status.type === 'ready')
  useEffect(() => api.onBrowserEngineStatus(setBrowserEngineStatus), [])
  useEffect(() => {
    void ensureBrowserEngine()
  }, [])
  return ready
}
