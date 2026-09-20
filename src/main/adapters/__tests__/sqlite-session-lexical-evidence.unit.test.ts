import { describe, expect, it, vi } from 'vitest'
import {
  decorateLexicalDiscoveryRows,
  type LexicalDiscoverySearchRow,
} from '../sqlite-session-lexical-evidence'

function row(overrides: Partial<LexicalDiscoverySearchRow> = {}): LexicalDiscoverySearchRow {
  return {
    session_id: 'evidence-session',
    title: 'Evidence Session',
    project_path: '/project',
    archived: 0,
    created_at: 1,
    updated_at: 2,
    parent_session_id: null,
    hive_root_session_id: null,
    direct_worker_count: 0,
    profile_json: null,
    delegation_id: null,
    delegation_state: null,
    score: -0.125,
    matched_fields: 'discovery',
    snippet: null,
    exact_match: 0,
    transcript_node_id: null,
    transcript_run_id: null,
    transcript_created_order: null,
    discovery_initial_objective: 'cafe',
    discovery_current_preview: 'cafe',
    ...overrides,
  }
}

describe('SQLite lexical discovery evidence', () => {
  it('prepares query normalization once for the result batch rather than each field and snippet', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row({
        session_id: `evidence-${index}`,
        discovery_initial_objective: `${'context '.repeat(40)}cafe ${'tail '.repeat(60)}`,
      }),
    )
    const normalize = vi.spyOn(String.prototype, 'normalize')
    try {
      const decorated = decorateLexicalDiscoveryRows(rows, 'CAFÉ')
      expect(decorated.map((entry) => entry.matched_fields)).toEqual(
        rows.map(() => 'initial-objective,current-preview'),
      )
      expect(normalize.mock.contexts.filter((character) => character === 'É')).toHaveLength(2)
    } finally {
      normalize.mockRestore()
    }
  })

  it.each([
    {
      query: 'alpha beta',
      initial: 'beta filler alpha',
      preview: 'alpha gap beta',
      fields: 'initial-objective,current-preview',
      snippet: 'beta filler alpha',
    },
    {
      query: '"alpha beta"',
      initial: 'alpha gap beta',
      preview: 'alpha beta',
      fields: 'current-preview',
      snippet: 'alpha beta',
    },
    {
      query: '"alpha alpha"',
      initial: 'alpha',
      preview: 'alpha alpha',
      fields: 'current-preview',
      snippet: 'alpha alpha',
    },
    {
      query: 'alpha alpha',
      initial: 'alpha',
      preview: 'alpha alpha',
      fields: 'initial-objective,current-preview',
      snippet: 'alpha',
    },
    {
      query: 'alpha-beta',
      initial: 'alpha gap beta',
      preview: 'alpha beta',
      fields: 'current-preview',
      snippet: 'alpha beta',
    },
    {
      query: 'alpha_beta GAMMA',
      initial: 'alpha beta filler gamma',
      preview: 'alpha gap beta gamma',
      fields: 'initial-objective',
      snippet: 'alpha beta filler gamma',
    },
    {
      query: 'CAFÉ 中文',
      initial: 'Café 中文',
      preview: 'cafe space 中文',
      fields: 'initial-objective,current-preview',
      snippet: 'Café 中文',
    },
    {
      query: '"Йога café"',
      initial: 'Йога café',
      preview: 'Иога cafe',
      fields: 'initial-objective',
      snippet: 'Йога café',
    },
    {
      query: 'cafe\u0301 \uE000',
      initial: 'café \uE000',
      preview: 'cafe \u{F0000}',
      fields: 'initial-objective',
      snippet: 'café \uE000',
    },
    {
      query: '!!!',
      initial: '',
      preview: '',
      fields: 'initial-objective,current-preview',
      snippet: '',
    },
  ])('retains field, snippet, and metadata output for $query', (entry) => {
    const input = row({
      discovery_initial_objective: entry.initial,
      discovery_current_preview: entry.preview,
    })
    expect(decorateLexicalDiscoveryRows([input], entry.query)).toEqual([
      { ...input, matched_fields: entry.fields, snippet: entry.snippet },
    ])
  })

  it('keeps the exact snippet window and ellipses around a late ASCII match', () => {
    const initial = `${'x'.repeat(260)} alpha ${'y'.repeat(300)}`
    const input = row({ discovery_initial_objective: initial, discovery_current_preview: 'other' })
    expect(decorateLexicalDiscoveryRows([input], 'ALPHA')).toEqual([
      { ...input, matched_fields: 'initial-objective', snippet: `… ${initial.slice(141, 381)} …` },
    ])
  })

  it('preserves the leading snippet when normalized terms are absent from the lowercase text', () => {
    const initial = `${'x'.repeat(260)} café ${'y'.repeat(300)}`
    const input = row({ discovery_initial_objective: initial, discovery_current_preview: 'other' })
    expect(decorateLexicalDiscoveryRows([input], 'CAFÉ')).toEqual([
      { ...input, matched_fields: 'initial-objective', snippet: `${initial.slice(0, 240)} …` },
    ])
  })

  it.each([240, 241])('preserves the %i-character snippet boundary', (length) => {
    const initial = `alpha ${'x'.repeat(length - 6)}`
    const input = row({ discovery_initial_objective: initial, discovery_current_preview: 'other' })
    expect(decorateLexicalDiscoveryRows([input], 'alpha')).toEqual([
      {
        ...input,
        matched_fields: 'initial-objective',
        snippet: length === 240 ? initial : `${initial.slice(0, 240)} …`,
      },
    ])
  })

  it.each(['existing title snippet', ''])(
    'keeps existing snippet %j and other matched fields',
    (snippet) => {
      const input = row({ matched_fields: 'title,discovery,project', snippet })
      expect(decorateLexicalDiscoveryRows([input], 'cafe')).toEqual([
        { ...input, matched_fields: 'title,project,initial-objective,current-preview' },
      ])
    },
  )

  it('leaves other evidence rows untouched and skips preparation without discovery matches', () => {
    const input = row({ matched_fields: 'title,transcript', snippet: 'Existing evidence' })
    const normalize = vi.spyOn(String.prototype, 'normalize')
    try {
      expect(decorateLexicalDiscoveryRows([input], 'CAFÉ')[0]).toBe(input)
      expect(decorateLexicalDiscoveryRows([], 'CAFÉ')).toEqual([])
      expect(normalize).not.toHaveBeenCalled()
    } finally {
      normalize.mockRestore()
    }
  })
})
