import { describe, expect, it } from 'vitest'
import { isSettingsTab, parseChatRouteSearch } from '../-route-search'

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

  it('preserves supported right panel modes', () => {
    expect(parseChatRouteSearch({ panel: 'session-tree' })).toEqual({ panel: 'session-tree' })
    expect(parseChatRouteSearch({ panel: 'diff' })).toEqual({ panel: 'diff' })
    expect(parseChatRouteSearch({ panel: 'other' })).toEqual({})
  })
})

describe('settings route guard', () => {
  it('accepts the extensions settings route tab', () => {
    expect(isSettingsTab('extensions')).toBe(true)
  })

  it('rejects unknown settings route tabs', () => {
    expect(isSettingsTab('unknown')).toBe(false)
  })
})
