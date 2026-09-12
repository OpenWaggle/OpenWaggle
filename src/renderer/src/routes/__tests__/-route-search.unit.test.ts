import { describe, expect, it } from 'vitest'
import {
  changeRequestUrlFromSearch,
  extensionSidePanelTargetFromSearch,
  isSettingsTab,
  parseChatRouteSearch,
  resourceBrowserTargetFromSearch,
} from '../-route-search'

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

  it('binds a change-request route to the Session that opened it', () => {
    const search = parseChatRouteSearch({
      panel: 'change-request',
      changeRequestUrl: 'https://github.com/o/r/pull/7',
      changeRequestSessionId: 'session-a',
    })
    expect(changeRequestUrlFromSearch(search, 'session-a')).toBe('https://github.com/o/r/pull/7')
    expect(changeRequestUrlFromSearch(search, 'session-b')).toBeNull()
    expect(parseChatRouteSearch({ panel: 'change-request', changeRequestUrl: 'x' })).toEqual({})
  })

  it('preserves the selected resource view and item only for the resources panel', () => {
    const search = parseChatRouteSearch({
      panel: 'resources',
      resourceView: 'outputs',
      resourceId: 'created-pr',
    })

    expect(search).toEqual({
      panel: 'resources',
      resourceView: 'outputs',
      resourceId: 'created-pr',
    })
    expect(resourceBrowserTargetFromSearch(search)).toEqual({
      view: 'outputs',
      resourceId: 'created-pr',
    })
    expect(
      parseChatRouteSearch({ panel: 'diff', resourceView: 'outputs', resourceId: 'created-pr' }),
    ).toEqual({ panel: 'diff' })
  })

  it('drops every throwaway design-exploration search key', () => {
    // The prototypes and the mockup that replaced them are gone, so none of their keys may survive
    // parsing. Kept as a test because a stray key in the route contract outlives the code it served.
    expect(parseChatRouteSearch({ mockup: 'notifications' })).toEqual({})
    expect(parseChatRouteSearch({ prototype: 'notifications', variant: 'B1' })).toEqual({})
  })

  it('preserves complete extension side panel selections with explicit search keys', () => {
    const search = parseChatRouteSearch({
      panel: 'extension-side-panel',
      sidePanelExtensionId: 'sample-extension',
      sidePanelId: 'sample.side-panel',
      sidePanelPackagePath: '/tmp/extensions/sample-extension',
      sidePanelContentHash: 'abcdef',
    })

    expect(search).toEqual({
      panel: 'extension-side-panel',
      sidePanelExtensionId: 'sample-extension',
      sidePanelId: 'sample.side-panel',
      sidePanelPackagePath: '/tmp/extensions/sample-extension',
      sidePanelContentHash: 'abcdef',
    })
    expect(extensionSidePanelTargetFromSearch(search)).toEqual({
      extensionId: 'sample-extension',
      sidePanelId: 'sample.side-panel',
      packagePath: '/tmp/extensions/sample-extension',
      contentHash: 'abcdef',
    })
  })

  it('drops incomplete extension side panel selections instead of creating stringly panels', () => {
    expect(
      parseChatRouteSearch({
        panel: 'extension-side-panel',
        sidePanelExtensionId: 'sample-extension',
      }),
    ).toEqual({})
    expect(
      parseChatRouteSearch({
        panel: 'extension-side-panel',
        sidePanelId: 'sample.side-panel',
      }),
    ).toEqual({})
  })

  it('ignores side panel ids when a built-in panel is selected', () => {
    expect(
      parseChatRouteSearch({
        panel: 'diff',
        sidePanelExtensionId: 'sample-extension',
        sidePanelId: 'sample.side-panel',
        sidePanelPackagePath: '/tmp/extensions/sample-extension',
        sidePanelContentHash: 'abcdef',
      }),
    ).toEqual({ panel: 'diff' })
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
