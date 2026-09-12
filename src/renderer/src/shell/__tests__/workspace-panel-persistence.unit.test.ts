import { describe, expect, it } from 'vitest'
import { sanitizeWorkspacePanelGroups } from '../workspace-panel-persistence'

describe('workspace panel persistence', () => {
  it('restores safe browser metadata while clearing transient native-view state', () => {
    expect(
      sanitizeWorkspacePanelGroups({
        'session-1': {
          browserTabs: [
            {
              id: 'preview-1',
              url: 'https://example.com/docs',
              title: 'Docs',
              loading: true,
              canGoBack: true,
              canGoForward: true,
              error: 'stale crash',
            },
          ],
          activeSurface: { kind: 'browser', previewId: 'preview-1' },
          maximized: true,
          panelOpen: true,
        },
      }),
    ).toEqual({
      'session-1': {
        browserTabs: [
          {
            id: 'preview-1',
            kind: 'preview',
            url: 'https://example.com/docs',
            title: 'Docs',
            loading: false,
            canGoBack: false,
            canGoForward: false,
            error: null,
            audioMuted: false,
            audible: false,
            favicon: null,
            ownerKey: 'session-1',
            profileId: 'default',
            controller: { kind: 'human' },
          },
        ],
        activeSurface: { kind: 'browser', previewId: 'preview-1' },
        maximized: true,
        panelOpen: true,
      },
    })
  })

  it('rejects malformed records, credential URLs, and missing active tabs', () => {
    expect(
      sanitizeWorkspacePanelGroups({
        malformed: ['not', 'a', 'group'],
        unsafe: {
          browserTabs: [{ id: 'preview-1', url: 'https://user:secret@example.com/' }],
          activeSurface: { kind: 'browser', previewId: 'preview-1' },
        },
        missing: {
          browserTabs: [{ id: 'preview-2', url: 'https://example.com/' }],
          activeSurface: { kind: 'browser', previewId: 'other-preview' },
        },
      }),
    ).toEqual({
      missing: {
        browserTabs: [
          {
            id: 'preview-2',
            kind: 'preview',
            url: 'https://example.com/',
            title: 'example.com',
            loading: false,
            canGoBack: false,
            canGoForward: false,
            error: null,
            audioMuted: false,
            audible: false,
            favicon: null,
            ownerKey: 'missing',
            profileId: 'default',
            controller: { kind: 'human' },
          },
        ],
        activeSurface: { kind: 'browser', previewId: 'preview-2' },
        maximized: false,
        panelOpen: true,
      },
    })
  })

  it('defaults legacy groups to restored size instead of maximizing implicitly', () => {
    expect(
      sanitizeWorkspacePanelGroups({
        'session-1': {
          browserTabs: [],
          activeSurface: { kind: 'terminal' },
          panelOpen: true,
        },
      })['session-1']?.maximized,
    ).toBe(false)
  })

  it('restores empty launchers without materializing native views or stale agent control', () => {
    expect(
      sanitizeWorkspacePanelGroups({
        'session-1': {
          browserTabs: [
            {
              id: 'launcher-1',
              kind: 'launcher',
              profileId: 'work',
              url: 'https://stale.example/',
              title: 'New browser',
              audioMuted: true,
              controller: { kind: 'agent', action: 'click', pointer: { x: 1, y: 2 } },
            },
          ],
          activeSurface: { kind: 'browser', previewId: 'launcher-1' },
          panelOpen: true,
        },
      })['session-1']?.browserTabs,
    ).toEqual([
      {
        id: 'launcher-1',
        ownerKey: 'session-1',
        kind: 'launcher',
        profileId: 'work',
        url: '',
        title: 'New browser',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: null,
        audioMuted: true,
        audible: false,
        favicon: null,
        controller: { kind: 'human' },
      },
    ])
  })
})
