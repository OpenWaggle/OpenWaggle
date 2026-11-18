import type { SessionId } from '@shared/types/brand'
import { useEffect, useRef } from 'react'
import { useSessionStatusStore } from '@/features/sessions/state'
import { registerSidebarSessionActions } from '../lib/session-actions-registry'
import type { SidebarSessionActions } from '../model'

/**
 * Shares the Sidebar's session actions with Hive panel rows (ADR 0051).
 *
 * The handlers are rebuilt on Sidebar renders, so registration hands over one stable object that
 * calls the latest handlers. Re-registering on each render would notify every Hive row twice per
 * render (unregister, then register) for no change in behavior.
 */
export function useRegisterSidebarSessionActions(
  session: Omit<SidebarSessionActions, 'markUnread'>,
) {
  const latest = useRef(session)
  useEffect(() => {
    latest.current = session
  })
  useEffect(() => {
    registerSidebarSessionActions({
      select: (id: SessionId) => latest.current.select(id),
      delete: (id: SessionId) => latest.current.delete(id),
      archive: (id: SessionId) => latest.current.archive(id),
      clone: (id: SessionId) => latest.current.clone(id),
      togglePin: (id: SessionId) => latest.current.togglePin(id),
      // markUnread is store-only, so it joins the domain actions here.
      markUnread: (id: SessionId) => useSessionStatusStore.getState().markUnread(id),
    })
    return () => registerSidebarSessionActions(null)
  }, [])
}
