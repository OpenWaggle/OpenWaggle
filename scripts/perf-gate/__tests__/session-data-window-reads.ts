/**
 * The desktop window's reads for two moments, as the renderer issues them, against the Host:
 *
 * - opening the sidebar: the Session catalog load (`loadCatalog` in
 *   `features/sessions/state/session-catalog-store-actions.ts`: the active and archived first
 *   pages and the Pinned sessions, hydrated by id in batches of the catalog page size) and the
 *   sidebar's exact counts (`queryTerminalSidebarCounts` in
 *   `features/sidebar/hooks/remote-sidebar-session-query.ts`, `useInterruptedSessionCount`);
 * - opening a Session that is not cached: its detail through the window's detail reader
 *   (`shared/lib/session-detail-reader.ts`, nothing held yet), its workspace with the newest
 *   transcript window (`features/sessions/lib/session-workspace-window.ts`, the chat route's
 *   `showSessionWorkspace`) and its turn checkpoints (`queries/turn-checkpoints.ts`, the turn
 *   reveal). The catalog reload that follows the detail is the sidebar's read, measured there.
 *
 * The page and window sizes are the renderer's own constants. The window sends some of these
 * reads together; here they run one after another, so the Host never coalesces two of them (a
 * Session read's Pi file refresh is shared while one is in flight) by timing alone.
 */
import type { SessionId } from '@shared/types/brand'
import { SESSION_CATALOG_PAGE_SIZE } from '@shared/types/openwaggle-api-session-catalog'
import { SESSION_QUERY_CONTRACT_VERSION, type SessionQuery } from '@shared/types/session-query'
import {
  SESSION_DETAIL_MESSAGE_WINDOW,
  TRANSCRIPT_WINDOW_PAGE_ENTRIES,
} from '@shared/types/session-transcript-window'
import { batchesOf } from '@shared/utils/batches'
import type { SessionHostReads } from './session-host-reads'

/** The sidebar counts read one row: the Host answers with the exact total. */
const COUNT_ONLY_LIMIT = 1
/** Digits of a UUID's last group. */
const UUID_NODE_DIGITS = 12

type SidebarCountFilter = Pick<
  Extract<SessionQuery, { readonly operation: 'list' }>,
  'unreadTerminalStatus' | 'interrupted'
>

async function loadPinnedSessionSummaries(host: SessionHostReads) {
  const pins = await host.hostUi('sessions:pins:list')
  const ids = pins.map((pin) => pin.sessionId)
  const sessions = []
  for (const batch of batchesOf(ids, SESSION_CATALOG_PAGE_SIZE)) {
    sessions.push(...(await host.hostUi('sessions:list-by-ids', batch)))
  }
  return sessions
}

function countSidebarSessions(host: SessionHostReads, filter: SidebarCountFilter, index: number) {
  return host.querySessionControl({
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    // The window sends a random UUID; a fixed one of the same length keeps the bytes fixed.
    requestId: `00000000-0000-4000-8000-${String(index).padStart(UUID_NODE_DIGITS, '0')}`,
    query: { operation: 'list', archived: false, limit: COUNT_ONLY_LIMIT, ...filter },
  })
}

export async function openSidebar(host: SessionHostReads) {
  const active = await host.hostUi('sessions:list-page', false, SESSION_CATALOG_PAGE_SIZE)
  const archived = await host.hostUi('sessions:list-page', true, SESSION_CATALOG_PAGE_SIZE)
  const pinned = await loadPinnedSessionSummaries(host)
  await countSidebarSessions(host, { unreadTerminalStatus: 'completed' }, 0)
  await countSidebarSessions(host, { unreadTerminalStatus: 'failed' }, 1)
  await countSidebarSessions(host, { interrupted: true }, 2)
  return { active, archived, pinned }
}

export async function openSession(host: SessionHostReads, sessionId: SessionId) {
  const detail = await host.hostUi('sessions:get-detail', sessionId, {
    nodeMutationRevision: 0,
    messageCount: 0,
    lastMessageId: null,
    maxMessages: SESSION_DETAIL_MESSAGE_WINDOW,
  })
  const workspace = await host.hostUi(
    'sessions:get-workspace',
    sessionId,
    { branchId: null, nodeId: null },
    { window: { minEntries: TRANSCRIPT_WINDOW_PAGE_ENTRIES } },
  )
  const checkpoints = await host.hostUi('sessions:turn-checkpoints:list', sessionId)
  return { detail, workspace, checkpoints }
}
