import type { ExtensionBrokerTransport } from '@shared/extension-sdk-core'
import { expect, it, vi } from 'vitest'
import type { DiscoveredExtensionPackage } from '../types'

vi.mock('../../env', () => ({ env: { OPENWAGGLE_AUTOMATION: '1' } }))

import {
  activateTrustedMainExtension,
  TrustedMainAutomationDisabledError,
} from '../trusted-main-runtime'

const extensionPackage = {
  id: 'automation-escape-probe',
  scope: { kind: 'project', projectPath: '/tmp/project' },
  packagePath: '/tmp/project/.openwaggle/extensions/automation-escape-probe',
  manifestPath:
    '/tmp/project/.openwaggle/extensions/automation-escape-probe/openwaggle.extension.json',
  manifest: null,
  buildPlan: null,
  contentHash: 'content-hash',
  sdkCompatibility: null,
  diagnostics: [],
} satisfies DiscoveredExtensionPackage

const unusedTransport: ExtensionBrokerTransport = async () => {
  throw new Error('Unexpected broker invocation.')
}

it('rejects trusted main activation before loading extension code during automation', async () => {
  const loadModule = vi.fn()

  await expect(
    activateTrustedMainExtension({
      extensionPackage,
      contentHash: 'content-hash',
      transport: unusedTransport,
      loadModule,
    }),
  ).rejects.toBeInstanceOf(TrustedMainAutomationDisabledError)
  expect(loadModule).not.toHaveBeenCalled()
})
