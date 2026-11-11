import { describe, it, vi } from 'vitest'
import type { PortContract } from '../../../../ports/desktop-shell/__tests__/contracts/port-contract'
import { trustedOriginsContract } from '../../../../ports/desktop-shell/__tests__/contracts/trusted-origins.contract'
import { memoryRememberedPorts } from '../loopback-test-support'

vi.mock('../../../../desktop-shell/app-paths', () => ({
  appPaths: { userData: () => '/nonexistent-user-data' },
}))

/** One test per contract case, each against a freshly prepared Electrobun shell. */
function runContract<Harness>(contract: PortContract<Harness>, setup: () => Promise<Harness>) {
  describe(`${contract.port} contract (Electrobun)`, () => {
    it.for(Object.entries(contract.cases))('%s', async ([, check]) => check(await setup()))
  })
}

runContract(trustedOriginsContract, async () => {
  const { createLoopbackTrustedOrigins } = await import('../../electrobun-trusted-origins')
  return {
    subject: createLoopbackTrustedOrigins({ rememberedPorts: memoryRememberedPorts() }),
    // A page's request reaches the real loopback server, as the webview's would.
    request: (url) => fetch(url),
  }
})
