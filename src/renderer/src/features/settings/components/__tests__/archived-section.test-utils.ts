import type { ArchivedItem, ArchivedItemsPage } from '@shared/types/archived-items'
import { SessionBranchId, SessionId } from '@shared/types/brand'

const HOUR = 3_600_000

/** Midday, so fixtures an hour or three old always fall on the same local day. */
export const FIXTURE_NOW = new Date(2026, 9, 14, 12).getTime()

export const sessionItem: ArchivedItem = {
  ref: { kind: 'session', sessionId: SessionId('session-settings') },
  title: 'Migrate settings to Effect Schema',
  parentTitle: null,
  projectPath: '/work/openwaggle',
  archivedAt: FIXTURE_NOW - HOUR,
  snippet: null,
}

export const transcriptItem: ArchivedItem = {
  ref: { kind: 'session', sessionId: SessionId('session-oauth') },
  title: 'Fix MCP OAuth refresh flake',
  parentTitle: null,
  projectPath: '/work/openwaggle',
  archivedAt: FIXTURE_NOW - 2 * HOUR,
  snippet: { text: 'the token refresh retries without backoff', highlights: [[10, 17]] },
}

export const branchItem: ArchivedItem = {
  ref: {
    kind: 'branch',
    sessionId: SessionId('session-prototypes'),
    branchId: SessionBranchId('session-prototypes:branch:b'),
  },
  title: 'Alternative approach',
  parentTitle: 'Archive search prototypes',
  projectPath: '/work/ts-match',
  archivedAt: FIXTURE_NOW - 3 * HOUR,
  snippet: null,
}

export function archivedPage(
  items: readonly ArchivedItem[],
  overrides: Partial<ArchivedItemsPage> = {},
): ArchivedItemsPage {
  const sessions = items.filter((item) => item.ref.kind === 'session').length
  return {
    items,
    total: items.length,
    facets: {
      projects: [
        { projectPath: '/work/openwaggle', count: 2 },
        { projectPath: '/work/ts-match', count: 1 },
      ],
      archivedWithin: {
        any: items.length,
        day: items.length,
        week: items.length,
        month: items.length,
        older: 0,
      },
      kinds: { all: items.length, session: sessions, branch: items.length - sessions },
    },
    ...overrides,
  }
}
