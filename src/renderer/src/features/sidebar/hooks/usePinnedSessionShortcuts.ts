import type { SessionId } from '@shared/types/brand'
import { useHotkeys } from '@tanstack/react-hotkeys'
import { useNavigate } from '@tanstack/react-router'
import { useChatStore } from '@/features/chat/state'
import { useSessions } from '@/features/sessions/hooks'
import { buildPinnedSessionRows } from '@/features/sidebar/lib/pinned-sessions'
import { usePinnedSessionsStore } from '@/features/sidebar/state/pinned-sessions-store'

/**
 * The nine Pinned shortcut hotkeys, spelled out because the hotkey type is a literal
 * union. A test asserts this list stays the same length as PINNED_SHORTCUT_LIMIT, which
 * is what the badges are rendered from.
 */
export const PINNED_SHORTCUT_HOTKEYS = [
  'Mod+1',
  'Mod+2',
  'Mod+3',
  'Mod+4',
  'Mod+5',
  'Mod+6',
  'Mod+7',
  'Mod+8',
  'Mod+9',
] as const

/**
 * Pinned shortcuts: Mod+1..Mod+9 open the 1st..9th row of the Pinned section (issue #97).
 *
 * The mapping is **positional**, resolved against the rows as currently ordered, so it
 * re-derives after any reorder or Pinned sort change — a badge can never point at a
 * different session than the row it sits on. Rows past the ninth simply have no shortcut;
 * the list is never capped, so a pin is never refused.
 */
export function usePinnedSessionShortcuts(): void {
  const navigate = useNavigate()
  const pins = usePinnedSessionsStore((state) => state.pins)
  const sortMode = usePinnedSessionsStore((state) => state.sortMode)
  const { sessions } = useSessions()

  const rows = buildPinnedSessionRows({ pins, sessions, sortMode })

  function openPinnedSession(sessionId: SessionId) {
    useChatStore.getState().setActiveSession(sessionId)
    void navigate({ to: '/sessions/$sessionId', params: { sessionId: String(sessionId) } })
  }

  useHotkeys(
    PINNED_SHORTCUT_HOTKEYS.map((hotkey, index) => ({
      hotkey,
      callback: () => {
        const row = rows[index]
        if (!row) return
        openPinnedSession(row.session.id)
      },
    })),
    { preventDefault: true },
  )
}
