import { describe, expect, it } from 'vitest'
import { shouldRenderWorkspaceFloatingPreview } from '../WorkspaceBrowserFloatingPreview'

const BASE = {
  activeClaim: { kind: 'workspace', ownerKey: 'session-1' },
  activeSurface: { kind: 'browser', previewId: 'preview-1' },
  ownerKey: 'session-1',
  panelOpen: true,
  previewId: 'preview-1',
} as const

describe('workspace floating browser visibility', () => {
  it('hides the floating copy while the same native preview is in the right panel', () => {
    expect(shouldRenderWorkspaceFloatingPreview(BASE)).toBe(false)
  })

  it('keeps floating over chat while another panel surface is visible', () => {
    expect(
      shouldRenderWorkspaceFloatingPreview({
        ...BASE,
        activeSurface: { kind: 'terminal' },
      }),
    ).toBe(true)
  })

  it('keeps floating when a route panel temporarily owns the right sidebar', () => {
    expect(
      shouldRenderWorkspaceFloatingPreview({
        ...BASE,
        activeClaim: { kind: 'route' },
      }),
    ).toBe(true)
  })
})
