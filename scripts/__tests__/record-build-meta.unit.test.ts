import { describe, expect, it } from 'vitest'

import { parseBuildMeta } from '../record-build-meta'

const HEAD_SHA = 'b945cccb86105b43734fd6889671ed0dc42fd15a'

function metaJson(commit: unknown, builtAt = '2026-09-01T12:00:00.000Z') {
  return JSON.stringify({ commit, builtAt })
}

describe('build metadata parsing', () => {
  it('parses a well-formed metadata file', () => {
    expect(parseBuildMeta(metaJson(HEAD_SHA))).toEqual({
      commit: HEAD_SHA,
      builtAt: '2026-09-01T12:00:00.000Z',
    })
  })

  it('normalizes a missing commit to null provenance', () => {
    expect(parseBuildMeta(metaJson(undefined))).toEqual({
      commit: null,
      builtAt: '2026-09-01T12:00:00.000Z',
    })
    expect(parseBuildMeta(metaJson(''))).toMatchObject({ commit: null })
    expect(parseBuildMeta(metaJson(null))).toMatchObject({ commit: null })
  })

  it('rejects non-object payloads and malformed JSON as unknown provenance', () => {
    expect(parseBuildMeta('[]')).toBeNull()
    expect(parseBuildMeta('"string"')).toBeNull()
    expect(parseBuildMeta('not json at all')).toBeNull()
  })

  it('keeps a non-string builtAt as an empty string without failing the parse', () => {
    expect(parseBuildMeta(JSON.stringify({ commit: HEAD_SHA, builtAt: 42 }))).toEqual({
      commit: HEAD_SHA,
      builtAt: '',
    })
  })
})
