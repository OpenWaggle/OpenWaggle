import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryArchivedItems } from '../sessions'
import {
  closeArchivedItemsStore,
  openArchivedItemsStore,
  runSql,
} from './archived-items.test-support'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const SESSION_COUNT = 20_000
/** One session in five is archived: 4,000 archived sessions among 20,000. */
const ARCHIVED_EVERY = 5
const TERMS_PER_SESSION = 40
const VOCABULARY = 2_000
/**
 * A generous ceiling for a loaded CI runner; locally each query takes 3 to 25 ms. Scanning the
 * whole transcript term table instead of probing per archived session takes seconds here.
 */
const QUERY_BUDGET_MS = 1_000
const ATTEMPTS = 3

beforeEach(() => openArchivedItemsStore(state))
afterEach(() => closeArchivedItemsStore(state))

async function seedCorpus() {
  await runSql(
    (sql) => sql`
      WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ${SESSION_COUNT - 1})
      INSERT INTO sessions (id, pi_session_id, title, project_path, archived, archived_at,
        created_at, updated_at)
      SELECT 'perf-' || n, 'pi-perf-' || n, 'Session ' || n || ' about topic ' || (n % 97),
        '/work/project-' || (n % 12), n % ${ARCHIVED_EVERY} = 0,
        CASE WHEN n % ${ARCHIVED_EVERY} = 0 THEN 1000 + n END, 1, 1
      FROM seq
    `,
  )
  await runSql(
    (sql) => sql`
      WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ${SESSION_COUNT - 1}),
      slot(k) AS (SELECT 0 UNION ALL SELECT k + 1 FROM slot WHERE k < ${TERMS_PER_SESSION - 1})
      INSERT INTO session_transcript_terms (term, session_id, occurrences, first_node_id,
        first_created_order)
      SELECT 'zeta' || ((n * 7 + k * 13) % ${VOCABULARY}), 'perf-' || n, 1, 'node-' || n, k
      FROM seq CROSS JOIN slot
    `,
  )
  await runSql(
    (sql) => sql`
      INSERT INTO session_transcript_term_documents (session_id, token_count)
      SELECT id, ${TERMS_PER_SESSION} FROM sessions
    `,
  )
  // One searchable message per session holding all its words, so the excerpt path runs against a
  // full-text index of 800,000 tokens in which every word shares the prefix "z".
  await runSql(
    (sql) => sql`
      INSERT INTO session_node_search (rowid, session_id, node_id, content)
      SELECT CAST(substr(session_id, 6) AS INTEGER) + 1, session_id, 'node-' || substr(session_id, 6),
        group_concat(term, ' ')
      FROM session_transcript_terms GROUP BY session_id
    `,
  )
  await runSql(
    (sql) => sql`
      INSERT INTO session_node_search_rows (node_id, session_id, search_rowid, created_order,
        searchable)
      SELECT 'node-' || substr(id, 6), id, CAST(substr(id, 6) AS INTEGER) + 1, 0, 1 FROM sessions
    `,
  )
}

/** The fastest of a few runs, so one scheduling stall on a shared runner does not fail it. */
async function timedQuery(text: string) {
  let elapsed = Number.POSITIVE_INFINITY
  let page = await queryArchivedItems({ text, limit: 50 }, Date.now())
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const started = performance.now()
    page = await queryArchivedItems({ text, limit: 50 }, Date.now())
    elapsed = Math.min(elapsed, performance.now() - started)
  }
  return { page, elapsed }
}

describe('Archived items query performance', () => {
  it('searches a 4,000-item archive among 20,000 sessions within budget', async () => {
    await seedCorpus()

    const browse = await timedQuery('')
    const title = await timedQuery('topic 42')
    const transcript = await timedQuery('zeta12')
    // One letter that only the transcripts hold: the worst case for the excerpts.
    const oneLetter = await timedQuery('z')
    const mixed = await timedQuery('session zeta1')

    expect(browse.page.total).toBe(SESSION_COUNT / ARCHIVED_EVERY)
    expect(title.page.total).toBeGreaterThan(0)
    expect(transcript.page.total).toBeGreaterThan(0)
    expect(mixed.page.total).toBeGreaterThan(0)
    expect(oneLetter.page.items[0]?.snippet?.highlights.length).toBeGreaterThan(0)
    for (const { elapsed } of [browse, title, transcript, oneLetter, mixed]) {
      expect(elapsed).toBeLessThan(QUERY_BUDGET_MS)
    }
  }, 120_000)
})
