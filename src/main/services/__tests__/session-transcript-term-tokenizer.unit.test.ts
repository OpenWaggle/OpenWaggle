import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { tokenizeSessionTranscriptTerms } from '../session-transcript-term-tokenizer'

function originalTranscriptTerms(value: string) {
  const normalized = [...value]
    .map((character) =>
      /\p{Script=Latin}/u.test(character)
        ? character.normalize('NFD').replace(/\p{M}+/gu, '')
        : character,
    )
    .join('')
    .toLowerCase()
  return normalized.match(/[\p{L}\p{N}\p{Co}]+/gu) ?? []
}

describe('Session transcript term tokenizer', () => {
  it('tokenizes every ASCII character without per-character Unicode normalization', () => {
    const input = Array.from({ length: 128 }, (_, index) => String.fromCharCode(index)).join('')
    const normalize = vi.spyOn(String.prototype, 'normalize')
    try {
      expect(tokenizeSessionTranscriptTerms(input)).toEqual([
        '0123456789',
        'abcdefghijklmnopqrstuvwxyz',
        'abcdefghijklmnopqrstuvwxyz',
      ])
      expect(normalize).not.toHaveBeenCalled()
    } finally {
      normalize.mockRestore()
    }
  })

  it('preserves token boundaries for every ASCII character between letters and digits', () => {
    for (let code = 0; code < 128; code += 1) {
      const input = `A${String.fromCharCode(code)}9`
      expect(tokenizeSessionTranscriptTerms(input), `ASCII ${code}`).toEqual(
        originalTranscriptTerms(input),
      )
    }
  })

  it.each([
    '',
    'Alpha ALPHA alpha 42_42 alpha-beta "alpha beta"',
    'CAFÉ Café café Ångström İSTANBUL',
    'Cafe\u0301 A\u0308 A\u0301 combining\u0301',
    'Йога Иога άλφα किताब 中文',
    '\uE000\uF8FF \u{F0000}\u{10FFFD}',
    'ASCII\uE000CAFÉ_42\u{F0000}中文',
    '\u0301\u0308\u0345 \u200D 😀 👨‍👩‍👧‍👦 \uD800 \uDFFF',
    '١٢٣ Ⅳ 𝟘 ABC\u0000déjà\u007Fvu',
  ])('preserves the original Unicode fallback and occurrence sequence for %j', (input) => {
    expect(tokenizeSessionTranscriptTerms(input)).toEqual(originalTranscriptTerms(input))
  })

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
