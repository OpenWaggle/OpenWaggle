import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { RendererSurface } from '../../renderer-surfaces'
import type { WebSecurityShape } from '../../web-security'

export interface WebSecurityContractHarness {
  readonly subject: WebSecurityShape
  readonly openPage: () => RendererSurface
  readonly closePage: (page: RendererSurface) => void
  /** The origins whose storage the page's web profile cleared, in order. */
  readonly clearedOrigins: (page: RendererSurface) => readonly string[]
}

export const webSecurityContract = definePortContract<WebSecurityContractHarness>('WebSecurity', {
  'clears origin storage through a handle that outlives the page': async ({
    subject,
    openPage,
    closePage,
    clearedOrigins,
  }) => {
    const page = openPage()
    const storage = subject.originStorageOf(page)
    storage.clear(['openwaggle-mcp-app://frame-1'])
    closePage(page)
    storage.clear(['openwaggle-mcp-app://frame-2'])
    expect(clearedOrigins(page)).toEqual([
      'openwaggle-mcp-app://frame-1',
      'openwaggle-mcp-app://frame-2',
    ])
  },

  "guards an open page's frames and refuses a closed page instead of leaving it unguarded": async ({
    subject,
    openPage,
    closePage,
  }) => {
    expect(() => subject.guardEmbeddedFrames(openPage())).not.toThrow()
    const page = openPage()
    closePage(page)
    expect(() => subject.guardEmbeddedFrames(page)).toThrow()
  },
})
