import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import { TRUSTED_MAIN_CONTRIBUTION_ID } from '../../extensions/trusted-main-runtime'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BROKER_CONTRIBUTION_ID,
  BROKER_EXTENSION_ID,
  makeProjectInvocation,
  runBroker,
  TIMESTAMP,
} from './extension-capability-broker-test-utils'
import { makeLifecycle, makePackage } from './extension-contribution-registry-test-utils'

const expectFailure = makeExpectBrokerFailure(TIMESTAMP)
const PACKAGE_MUTATION_CAPABILITY = 'openwaggle.extensions.packages'
const PACKAGE_MUTATION_METHOD = 'write-package'

describe('extension package mutation broker guard', () => {
  it('rejects trusted main attempts to mutate extension packages through broker capabilities', async () => {
    const basePackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Broker Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: PACKAGE_MUTATION_CAPABILITY,
          methods: [PACKAGE_MUTATION_METHOD],
          scopes: ['project'],
        },
      ],
      contributions: {
        commands: [{ id: BROKER_CONTRIBUTION_ID, title: 'Run Broker' }],
      },
    })
    const extensionPackage = {
      ...basePackage,
      manifest: basePackage.manifest
        ? {
            ...basePackage.manifest,
            trusted: { main: 'dist/index.js' },
          }
        : null,
    }

    const result = await runBroker({
      invocation: makeProjectInvocation({
        contributionId: TRUSTED_MAIN_CONTRIBUTION_ID,
        capability: PACKAGE_MUTATION_CAPABILITY,
        method: PACKAGE_MUTATION_METHOD,
        payload: {
          extensionId: 'target-extension',
          files: [{ relativePath: OPENWAGGLE_EXTENSION.MANIFEST_FILE, content: '{}' }],
        },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_CAPABILITY)
    if (result.ok) {
      throw new Error('Expected package mutation broker invocation to fail.')
    }
    expect(result.error.message).toContain('user-approved extension package workflow')
  })
})
