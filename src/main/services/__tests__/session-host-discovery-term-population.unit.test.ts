import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SESSION_DISCOVERY_TERM_GROUP_SQL,
  SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS,
} from '../session-host-discovery-term-population'
import { SESSION_DISCOVERY_TERM_SCHEMA_STATEMENTS } from '../session-host-discovery-term-schema'

describe('Session discovery native term bulk validation', () => {
  let database: DatabaseSync | undefined

  afterEach(() => {
    database?.close()
  })

  function createCatalog() {
    const target = new DatabaseSync(':memory:')
    database = target
    target.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE session_discovery_search_rows (
        session_id TEXT PRIMARY KEY, search_rowid INTEGER NOT NULL UNIQUE,
        initial_objective TEXT NOT NULL, current_preview TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE VIRTUAL TABLE session_node_discovery_search USING fts5(
        session_id UNINDEXED, archived UNINDEXED, initial_objective, current_preview,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      INSERT INTO session_node_discovery_search VALUES
        ('a', 0, 'Café alpha alpha', 'βήτα alpha'), ('b', 1, 'cafe', 'beta'), ('empty', 0, '', '');
      INSERT INTO session_discovery_search_rows
      SELECT session_id, rowid, initial_objective, current_preview FROM session_node_discovery_search;
    `)
    for (const statement of SESSION_DISCOVERY_TERM_SCHEMA_STATEMENTS) target.exec(statement)
    return target
  }

  it('traverses the native vocabulary only once and groups before looking up Session identities', () => {
    const target = createCatalog()
    target.exec(SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS[0])
    const plan = target.prepare(`EXPLAIN QUERY PLAN ${SESSION_DISCOVERY_TERM_GROUP_SQL}`).all()
    const scans = plan.flatMap((row) => (typeof row.detail === 'string' ? [row.detail] : []))
    expect(scans.filter((step) => step.includes('VIRTUAL TABLE INDEX'))).toHaveLength(1)
    expect(scans.some((step) => step.includes('CORRELATED'))).toBe(false)
    for (const statement of SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS.slice(1)) {
      target.exec(statement)
    }
    expect(
      target
        .prepare(`SELECT term, initial_frequency, preview_frequency, token_count
      FROM session_discovery_term_postings WHERE session_id = 'a' ORDER BY term`)
        .all(),
    ).toEqual([
      { term: 'alpha', initial_frequency: 2, preview_frequency: 1, token_count: 5 },
      { term: 'cafe', initial_frequency: 1, preview_frequency: 0, token_count: 5 },
      { term: 'βήτα', initial_frequency: 0, preview_frequency: 1, token_count: 5 },
    ])
    expect(target.prepare(`SELECT name FROM sqlite_temp_master`).all()).toEqual([])
  })

  it.each([
    {
      name: 'missing posting',
      mutation: `DELETE FROM session_discovery_term_postings WHERE term = 'alpha'`,
      constraint: 'discovery_native_postings',
    },
    {
      name: 'wrong native count',
      mutation: 'UPDATE session_discovery_term_postings SET token_count = token_count + 1',
      constraint: 'discovery_native_postings',
    },
    {
      name: 'invalid representative',
      mutation: 'UPDATE session_discovery_term_signatures SET representative_rowid = -1',
      constraint: 'discovery_native_signatures',
    },
    {
      name: 'wrong membership',
      mutation: 'UPDATE session_discovery_term_signatures SET member_count = member_count + 1',
      constraint: 'discovery_native_signatures',
    },
    {
      name: 'nonempty staging FTS',
      mutation: "INSERT INTO session_discovery_term_stage VALUES ('unexpected', '')",
      constraint: 'discovery_native_stage_empty',
    },
    {
      name: 'null native source',
      mutation:
        "UPDATE session_node_discovery_search SET initial_objective = NULL WHERE session_id = 'empty'",
      constraint: 'discovery_native_mapping',
    },
  ])(
    'rejects $name before publishing and rolls back temporary work',
    ({ mutation, constraint }) => {
      const target = createCatalog()
      target.exec('BEGIN IMMEDIATE')
      expect(() => {
        for (const statement of SESSION_DISCOVERY_TERM_POPULATION_STATEMENTS) {
          if (statement.startsWith('INSERT INTO session_discovery_term_validation'))
            target.exec(mutation)
          target.exec(statement)
        }
      }).toThrow(constraint)
      target.exec('ROLLBACK')
      expect(target.prepare('SELECT * FROM session_discovery_term_postings').all()).toEqual([])
      expect(target.prepare('SELECT name FROM sqlite_temp_master').all()).toEqual([])
      expect(target.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    },
  )
})
