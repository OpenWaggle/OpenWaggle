import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { SessionResource } from '@shared/types/session-resource'
import { describe, expect, it } from 'vitest'
import {
  BROKER_EXTENSION_ID,
  makeBrokerHarness,
  makeSessionDetail,
  SESSION_ID,
} from './extension-capability-broker-test-utils'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const CONTRIBUTION_ID = 'resources.publish'

function resourcesPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Resource Publisher',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE],
        scopes: ['session'],
      },
    ],
    contributions: {
      commands: [
        {
          id: CONTRIBUTION_ID,
          title: 'Publish resource',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE],
        },
      ],
    },
  })
}

function invocation(payload: unknown): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
    scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: SESSION_ID },
    payload,
  }
}

function resource(input: {
  readonly id: string
  readonly canonicalKey: string
  readonly kind: SessionResource['kind']
  readonly title: string
  readonly available?: boolean
}): SessionResource {
  return {
    id: input.id,
    sessionId: SessionId(SESSION_ID),
    canonicalKey: input.canonicalKey,
    kind: input.kind,
    title: input.title,
    mimeType: null,
    locator: input.canonicalKey.slice(input.canonicalKey.indexOf(':') + 1),
    managed: false,
    available: input.available ?? true,
    isSource: false,
    isOutput: true,
    occurrences: [],
    createdAt: 1000,
    updatedAt: 1000,
  }
}

function harness(resources: SessionResource[] = []) {
  const extensionPackage = resourcesPackage()
  return makeBrokerHarness({
    packages: [extensionPackage],
    lifecycles: [makeLifecycle(extensionPackage)],
    sessionDetail: makeSessionDetail(PROJECT_PATH),
    resources,
  })
}

describe('extension image resource identity', () => {
  it('does not let a generic publication adopt a legacy image row', async () => {
    const test = harness([
      resource({
        id: 'legacy-image',
        canonicalKey: 'url:https://images.example.com/architecture.png',
        kind: 'image',
        title: 'Legacy image',
      }),
    ])

    const result = await test.run(
      invocation({
        key: 'docs',
        title: 'Documentation',
        kind: 'link',
        role: 'source',
        locator: 'https://images.example.com/architecture.png',
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.TRANSPORT_FAILED },
    })
    expect(test.resourceUpserts()).toEqual([])
  })

  it('joins transcript images without consuming generic URL resources', async () => {
    const test = harness([
      resource({
        id: 'existing-link',
        canonicalKey: 'url:HTTPS://EXAMPLE.COM/shared',
        kind: 'change-request',
        title: 'Existing source',
        available: false,
      }),
      resource({
        id: 'existing-image',
        canonicalKey: 'image-url:https://example.com/shared',
        kind: 'image',
        title: 'Transcript image',
      }),
    ])

    await test.run(
      invocation({
        key: 'shared',
        title: 'Shared source',
        kind: 'image',
        role: 'source',
        locator: 'https://example.com/shared',
      }),
    )

    expect(test.resourceUpserts()[0]).toMatchObject({
      canonicalKey: 'image-url:https://example.com/shared',
      kind: 'image',
      title: 'Transcript image',
    })
    expect(test.resources()).toHaveLength(2)
  })

  it('stores new images under the image-specific normalized URL identity', async () => {
    const test = harness()

    await test.run(
      invocation({
        key: 'diagram',
        title: 'Architecture diagram',
        kind: 'image',
        role: 'output',
        locator: 'HTTPS://IMAGES.EXAMPLE.COM/diagram.png',
      }),
    )

    expect(test.resourceUpserts()).toContainEqual(
      expect.objectContaining({
        canonicalKey: 'image-url:https://images.example.com/diagram.png',
        kind: 'image',
      }),
    )
  })
})
