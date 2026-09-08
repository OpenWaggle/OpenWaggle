import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { populateSessionTranscriptTermCatalog } from '../session-transcript-term-cutover'
import { createTranscriptTermCutoverDatabase } from './session-transcript-term-cutover.test-support'

describe('Session transcript term cutover query plans', () => {
  let database: DatabaseSync

  beforeEach(() => {
    database = createTranscriptTermCutoverDatabase()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    database.close()
  })

  it('seeks the node cursor instead of rescanning the corpus for each batch', () => {
    database.exec(`
      CREATE UNIQUE INDEX idx_session_nodes_session_created_order_unique
      ON session_nodes (session_id, created_order);
    `)
    const prepare = database.prepare.bind(database)
    const plans: unknown[] = []
    vi.spyOn(database, 'prepare').mockImplementation((query) => {
      if (query.includes('WITH candidates AS MATERIALIZED')) {
        plans.push(...prepare(`EXPLAIN QUERY PLAN ${query}`).all())
      }
      return prepare(query)
    })

    populateSessionTranscriptTermCatalog(database)

    expect(plans).toContainEqual(
      expect.objectContaining({
        detail: expect.stringMatching(/^SEARCH nodes USING INDEX .*\(.*session_id/),
      }),
    )
    expect(plans).not.toContainEqual(
      expect.objectContaining({ detail: expect.stringMatching(/^SCAN nodes\b/) }),
    )
  })

  it('validates only the requested batch without scanning every Session document', () => {
    const prepare = database.prepare.bind(database)
    const plans: unknown[] = []
    vi.spyOn(database, 'prepare').mockImplementation((query) => {
      if (
        query.includes('requested.previous_token_count + COALESCE(token_counts.token_count, 0)')
      ) {
        plans.push(...prepare(`EXPLAIN QUERY PLAN ${query}`).all())
      }
      return prepare(query)
    })

    populateSessionTranscriptTermCatalog(database)

    expect(plans).toContainEqual(
      expect.objectContaining({
        detail: expect.stringMatching(/^SEARCH documents USING INDEX .*\(session_id=/),
      }),
    )
    expect(plans).not.toContainEqual(
      expect.objectContaining({ detail: expect.stringMatching(/^SCAN documents\b/) }),
    )
  })

  it('sums each Session through a covering batch index instead of rescanning every term', () => {
    const exec = database.exec.bind(database)
    const plans: unknown[] = []
    vi.spyOn(database, 'exec').mockImplementation((query) => {
      if (query.includes('UPDATE session_transcript_term_documents')) {
        const update = query.split(';')[0]
        plans.push(...database.prepare(`EXPLAIN QUERY PLAN ${update}`).all())
      }
      return exec(query)
    })

    populateSessionTranscriptTermCatalog(database)

    expect(plans).toContainEqual(
      expect.objectContaining({
        detail: expect.stringMatching(/^SEARCH groups USING COVERING INDEX .*\(session_id=/),
      }),
    )
    expect(plans).not.toContainEqual(
      expect.objectContaining({ detail: expect.stringMatching(/^SCAN groups\b/) }),
    )
  })
})
