import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { NetworkFetchShape } from '../../network-fetch'

export interface NetworkFetchContractHarness {
  readonly subject: NetworkFetchShape
  /** The URLs the shell's network stack sent, in order. */
  readonly sent: () => readonly string[]
  /** Fetches the way trusted-main extension code would (through the shell's own module). */
  readonly fetchAsExtension: (url: string) => Promise<Response>
}

class RefusedEgress extends Error {}

export const networkFetchContract = definePortContract<NetworkFetchContractHarness>(
  'NetworkFetch',
  {
    'sends a request through the shell network stack': async ({ subject, sent }) => {
      const response = await subject.fetch('https://example.com/data')
      expect(response.ok).toBe(true)
      expect(sent()).toEqual(['https://example.com/data'])
    },

    'checks extension requests against the egress policy while it is active': async ({
      subject,
      sent,
      fetchAsExtension,
    }) => {
      let active = true
      const checked: string[] = []
      subject.guardExtensionEgress({
        isActive: () => active,
        checkFetch: (api, input) => {
          const url = typeof input === 'string' ? input : input.url
          checked.push(url)
          if (url.includes('blocked')) throw new RefusedEgress(`${api} refused ${url}`)
        },
        checkUrl: () => undefined,
      })
      await expect(fetchAsExtension('https://blocked.example/')).rejects.toBeInstanceOf(
        RefusedEgress,
      )
      await fetchAsExtension('https://allowed.example/')
      active = false
      await fetchAsExtension('https://blocked.example/inactive')
      expect(checked).toEqual(['https://blocked.example/', 'https://allowed.example/'])
      expect(sent()).toEqual(['https://allowed.example/', 'https://blocked.example/inactive'])
    },
  },
)
