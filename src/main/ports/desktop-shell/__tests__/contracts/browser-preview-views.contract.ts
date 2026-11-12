import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { BrowserPreviewViewsShape } from '../../browser-preview-views'
import type { RendererSurface } from '../../renderer-surfaces'

export interface BrowserPreviewViewsContractHarness {
  readonly subject: BrowserPreviewViewsShape
  /** A page that closed: the surface a late IPC request may still name. */
  readonly closedPage: () => RendererSurface
}

export const browserPreviewViewsContract = definePortContract<BrowserPreviewViewsContractHarness>(
  'BrowserPreviewViews',
  {
    'knows no owner and no previews it was never given': async ({ subject }) => {
      expect(subject.isOwnerRegistered('session:unknown')).toBe(false)
      expect(subject.ownedPreviewCount('session:unknown')).toBe(0)
      await expect(subject.closeForOwner('session:unknown')).resolves.toBeUndefined()
    },

    'refuses a request from a page that has closed': async ({ subject, closedPage }) => {
      const page = closedPage()
      expect(() => subject.registerOwner('session:s-1', page)).toThrow()
      expect(() => subject.setCurrentPreview(page, 'session:s-1', 'p-1')).toThrow()
      expect(subject.isOwnerRegistered('session:s-1')).toBe(false)
    },
  },
)
