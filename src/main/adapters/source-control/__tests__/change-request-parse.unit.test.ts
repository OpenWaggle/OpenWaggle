import { describe, expect, it } from 'vitest'
import {
  mapGhPullRequest,
  mapGhState,
  mapGlabMergeRequest,
  mapGlabState,
} from '../change-request-parse'

describe('change-request-parse', () => {
  it('maps a gh PR json object', () => {
    expect(
      mapGhPullRequest({
        title: 'Add feature',
        url: 'https://github.com/o/r/pull/7',
        baseRefName: 'main',
        headRefName: 'feat',
        state: 'OPEN',
        isDraft: false,
      }),
    ).toEqual({
      title: 'Add feature',
      url: 'https://github.com/o/r/pull/7',
      baseRef: 'main',
      headRef: 'feat',
      state: 'open',
    })
  })

  it('maps a glab MR json object with draft', () => {
    expect(
      mapGlabMergeRequest({
        title: 'WIP',
        web_url: 'https://gitlab.com/o/r/-/merge_requests/3',
        target_branch: 'main',
        source_branch: 'feat',
        state: 'opened',
        draft: true,
      }),
    ).toMatchObject({ url: 'https://gitlab.com/o/r/-/merge_requests/3', state: 'draft' })
  })

  it('returns null for malformed input', () => {
    expect(mapGhPullRequest(null)).toBeNull()
    expect(mapGhPullRequest({ title: 'x' })).toBeNull()
    expect(mapGlabMergeRequest({})).toBeNull()
  })

  it('trims decoded string fields', () => {
    expect(
      mapGhPullRequest({
        title: '  Add feature  ',
        url: ' https://github.com/o/r/pull/7 ',
        baseRefName: ' main ',
        headRefName: ' feat ',
        state: 'OPEN',
      }),
    ).toEqual({
      title: 'Add feature',
      url: 'https://github.com/o/r/pull/7',
      baseRef: 'main',
      headRef: 'feat',
      state: 'open',
    })
  })

  it('maps states with draft precedence', () => {
    expect(mapGhState('OPEN', true)).toBe('draft')
    expect(mapGhState('MERGED', false)).toBe('merged')
    expect(mapGhState('CLOSED', false)).toBe('closed')
    expect(mapGhState('OPEN', false)).toBe('open')
    expect(mapGlabState('merged', false)).toBe('merged')
    expect(mapGlabState('opened', true)).toBe('draft')
    expect(mapGlabState('opened', false)).toBe('open')
  })
})
