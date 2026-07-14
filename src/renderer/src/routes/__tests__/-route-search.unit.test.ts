import { describe, expect, it } from 'vitest'
import {
  extensionSidePanelTargetFromSearch,
  isSettingsTab,
  parseChatRouteSearch,
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
