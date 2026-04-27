import { describe, expect, it } from 'vitest'
import { parseChatRouteSearch } from '../-route-search'

describe('parseChatRouteSearch', () => {
  it('preserves session workspace selectors and numeric diff flag', () => {
    expect(
      parseChatRouteSearch({
        branch: 'session:branch:node-1',
        node: 'node-2',
        diff: '1',
      }),
    ).toEqual({
      branch: 'session:branch:node-1',
      node: 'node-2',
      diff: 1,
    })
  })

  it('drops empty workspace selectors', () => {
    expect(parseChatRouteSearch({ branch: '', node: '   ', diff: 0 })).toEqual({})
  })
})
