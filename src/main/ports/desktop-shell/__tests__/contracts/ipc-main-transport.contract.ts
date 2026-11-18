import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { IpcInvocation, IpcMainTransportShape } from '../../ipc-transport'

export interface IpcMainTransportContractHarness {
  readonly subject: IpcMainTransportShape
  /** The page with this surface id invokes `channel`; resolves to the handler's answer. */
  readonly invokeFromPage: (
    surfaceId: number,
    channel: string,
    ...args: unknown[]
  ) => Promise<unknown>
  /** The page with this surface id sends `channel` without waiting. */
  readonly sendFromPage: (surfaceId: number, channel: string, ...args: unknown[]) => void
  /** Opens a page and returns its surface id. */
  readonly openPage: () => number
}

export const ipcMainTransportContract = definePortContract<IpcMainTransportContractHarness>(
  'IpcMainTransport',
  {
    'answers an invoke with the handler result and names the sending page': async ({
      subject,
      invokeFromPage,
      openPage,
    }) => {
      const page = openPage()
      const senders: number[] = []
      subject.handle('settings:get', (invocation: IpcInvocation) => {
        senders.push(invocation.sender.id)
        return { ok: true }
      })
      await expect(invokeFromPage(page, 'settings:get')).resolves.toEqual({ ok: true })
      expect(senders).toEqual([page])
    },

    'rejects the invoke when the handler rejects': async ({
      subject,
      invokeFromPage,
      openPage,
    }) => {
      subject.handle('settings:get', () => Promise.reject(new Error('refused')))
      await expect(invokeFromPage(openPage(), 'settings:get')).rejects.toThrow('refused')
    },

    'delivers a send to its listener with its arguments': async ({
      subject,
      sendFromPage,
      openPage,
    }) => {
      const page = openPage()
      const received: unknown[] = []
      subject.on('clipboard:write-text', (invocation, text) => {
        received.push(invocation.sender.id, text)
      })
      sendFromPage(page, 'clipboard:write-text', 'copied')
      expect(received).toEqual([page, 'copied'])
    },
  },
)
