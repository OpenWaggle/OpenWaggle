import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { RendererSurfacesShape } from '../../renderer-surfaces'

export interface RendererSurfacesContractHarness {
  readonly subject: RendererSurfacesShape
  /** Opens a page and returns its surface id. */
  readonly openPage: () => number
  readonly closePage: (id: number) => void
  /** What the page received through `window.api.on(channel)`. */
  readonly receivedByPage: (
    id: number,
  ) => readonly { readonly channel: string; readonly args: readonly unknown[] }[]
}

export const rendererSurfacesContract = definePortContract<RendererSurfacesContractHarness>(
  'RendererSurfaces',
  {
    'finds a live page by id and delivers events to it': async ({
      subject,
      openPage,
      receivedByPage,
    }) => {
      const id = openPage()
      const surface = subject.fromId(id)
      expect(surface?.id).toBe(id)
      expect(surface?.isDestroyed()).toBe(false)
      surface?.send('terminal:event', { data: 'ls' })
      expect(receivedByPage(id)).toEqual([{ channel: 'terminal:event', args: [{ data: 'ls' }] }])
    },

    'announces a closed page once and no longer finds it': async ({
      subject,
      openPage,
      closePage,
    }) => {
      const id = openPage()
      const surface = subject.fromId(id)
      const events: string[] = []
      surface?.once('destroyed', () => events.push('destroyed'))
      closePage(id)
      expect(events).toEqual(['destroyed'])
      expect(subject.fromId(id)).toBeNull()
      expect(subject.fromId(Number.MAX_SAFE_INTEGER)).toBeNull()
    },
  },
)
