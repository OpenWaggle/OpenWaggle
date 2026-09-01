import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { tokenizeSessionTranscriptTerms } from '../session-transcript-term-tokenizer'

describe('Session transcript term tokenizer', () => {
  it('normalizes case, Latin diacritics, punctuation, and non-Latin terms deterministically', () => {
    expect(tokenizeSessionTranscriptTerms('CAFÉ—Review_42 中文 Привет')).toEqual([
      'cafe',
      'review',
      '42',
      '中文',
      'привет',
    ])
  })

  it('retains duplicate terms for occurrence ranking', () => {
    expect(tokenizeSessionTranscriptTerms('worker Worker WORKER')).toEqual([
      'worker',
      'worker',
      'worker',
    ])
  })

  it('matches SQLite unicode61 token boundaries and diacritic removal', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec(`
        CREATE VIRTUAL TABLE transcript USING fts5(
          content, tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE transcript_vocabulary USING fts5vocab(transcript, 'row');
      `)
      const input = 'CAFÉ—Review_42 中文 Привет Йога Иога άλφα किताब'
      database.prepare('INSERT INTO transcript (content) VALUES (?)').run(input)
      const sqliteTerms = database
        .prepare('SELECT term FROM transcript_vocabulary ORDER BY term')
        .all()
        .map((row) =>
          typeof row === 'object' && row !== null && 'term' in row ? String(row.term) : '',
        )
      expect([...new Set(tokenizeSessionTranscriptTerms(input))].toSorted()).toEqual(sqliteTerms)
    } finally {
      database.close()
    }
  })
})
