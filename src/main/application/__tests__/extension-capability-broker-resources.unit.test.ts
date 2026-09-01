import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { SessionResource } from '@shared/types/session-resource'
import { describe, expect, it } from 'vitest'
import { TRUSTED_MAIN_CONTRIBUTION_ID } from '../../extensions/trusted-main-runtime'
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
type ResourceMethod =
  | typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES
  | typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE

function resourcesPackage(
  methods = [
    OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES,
    OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
  ],
) {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Resource Publisher',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
        methods,
        scopes: ['session'],
      },
    ],
    contributions: {
      commands: [
        {
          id: CONTRIBUTION_ID,
          title: 'Publish resource',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
          methods,
        },
      ],
    },
  })
}

function invocation(input: {
  readonly method: string
  readonly payload?: unknown
  readonly sessionId?: string
  readonly scope?: ExtensionInvokeInput['scope']
}): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
    method: input.method,
    scope:
      input.scope ??
      ({
        kind: 'session',
        projectPath: PROJECT_PATH,
        sessionId: input.sessionId ?? SESSION_ID,
      } as const),
    payload: input.payload ?? {},
  }
}

function privateResource(sessionId: string, id: string): SessionResource {
  return {
    id,
    sessionId: SessionId(sessionId),
    canonicalKey: `file:/private/${id}.png`,
    kind: 'image',
    title: `${id}.png`,
    mimeType: 'image/png',
    locator: `/private/${id}.png`,
    managed: true,
    available: true,
    isSource: true,
    isOutput: true,
    occurrences: [
      {
        id: `occurrence-${id}`,
        nodeId: `private-node-${id}`,
        branchId: `private-branch-${id}`,
        actor: 'user',
        activity: 'provided',
        label: 'private-label',
        createdAt: 1,
      },
      {
        id: `output-${id}`,
        nodeId: null,
        branchId: null,
        actor: 'agent',
        activity: 'updated',
        label: null,
        createdAt: 2,
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  }
}

function harness(methods?: readonly ResourceMethod[]) {
  const extensionPackage = resourcesPackage(methods ? [...methods] : undefined)
  return makeBrokerHarness({
    packages: [extensionPackage],
    lifecycles: [makeLifecycle(extensionPackage)],
    sessionDetail: makeSessionDetail(PROJECT_PATH),
    resources: [
      privateResource(SESSION_ID, 'session-resource'),
      privateResource('other-session', 'other-resource'),
    ],
  })
}

describe('extension session resource capability', () => {
  it('lists safe metadata only from the invocation session', async () => {
    const result = await harness().run(
      invocation({ method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES }),
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        sessionId: SESSION_ID,
        resources: [
          {
            id: 'session-resource',
            title: 'session-resource.png',
            kind: 'image',
            mimeType: 'image/png',
            available: true,
            isSource: true,
            isOutput: true,
          },
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain('/private/')
    expect(JSON.stringify(result)).not.toContain('private-node')
    expect(JSON.stringify(result)).not.toContain('private-label')
    expect(JSON.stringify(result)).not.toContain('other-resource')
  })

  it('publishes idempotent extension provenance into the exact scoped session', async () => {
    const test = harness()
    const request = invocation({
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
      payload: {
        key: 'release-notes',
        title: 'Release notes',
        kind: 'link',
        role: 'output',
        locator: 'HTTPS://EXAMPLE.COM/releases/1',
      },
    })

    const first = await test.run(request)
    const second = await test.run(request)

    expect(first).toMatchObject({
      ok: true,
      value: {
        sessionId: SESSION_ID,
        resource: { title: 'Release notes', kind: 'link', isOutput: true },
      },
    })
    expect(second).toMatchObject({ ok: true, value: { sessionId: SESSION_ID } })
    const publications = test.resourceUpserts().filter(({ title }) => title === 'Release notes')
    expect(publications[0]?.locator).toBe('https://example.com/releases/1')
    expect(new Set(publications.map(({ occurrence }) => occurrence.id)).size).toBe(1)
    expect(publications.every(({ sessionId }) => sessionId === SessionId(SESSION_ID))).toBe(true)
    expect(publications.every(({ occurrence }) => occurrence.actor === 'extension')).toBe(true)
    expect(
      test.resources().find(({ title }) => title === 'Release notes')?.occurrences,
    ).toHaveLength(1)
  })

  it('adopts legacy URL identity while normalizing its locator and retaining provenance', async () => {
    const existing: SessionResource = {
      ...privateResource(SESSION_ID, 'existing-link'),
      canonicalKey: 'url:HTTPS://EXAMPLE.COM/shared',
      kind: 'link',
      title: 'Existing source',
      locator: 'HTTPS://EXAMPLE.COM/shared',
      managed: false,
    }
    const extensionPackage = resourcesPackage()
    const test = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      resources: [existing],
    })

    const result = await test.run(
      invocation({
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
        payload: {
          key: 'shared',
          title: 'Shared source',
          kind: 'link',
          role: 'source',
          locator: 'HTTPS://EXAMPLE.COM/shared',
        },
      }),
    )

    expect(result).toMatchObject({ ok: true, value: { resource: { id: 'existing-link' } } })
    expect(test.resources()).toHaveLength(1)
    expect(test.resourceUpserts()[0]?.occurrence.id).toContain(':shared:source:HTTPS://')
  })

  it('rejects unbound trusted-main resource access', async () => {
    const basePackage = resourcesPackage()
    const trustedPackage = {
      ...basePackage,
      manifest: basePackage.manifest
        ? { ...basePackage.manifest, trusted: { main: 'dist/main.js' } }
        : null,
    }
    const test = makeBrokerHarness({
      packages: [trustedPackage],
      lifecycles: [makeLifecycle(trustedPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
    })

    const result = await test.run({
      ...invocation({ method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES }),
      contributionId: TRUSTED_MAIN_CONTRIBUTION_ID,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE },
    })
  })

  it('rejects unscoped, inaccessible-session, unsafe URL, extra-key, and undeclared writes', async () => {
    const test = harness()
    const basePayload = {
      key: 'unsafe',
      title: 'Unsafe',
      kind: 'link',
      role: 'source',
      locator: 'https://example.com/safe',
    }
    const results = await Promise.all([
      test.run(
        invocation({
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES,
          scope: { kind: 'project', projectPath: PROJECT_PATH },
        }),
      ),
      test.run(
        invocation({
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES,
          sessionId: 'other-session',
        }),
      ),
      test.run(
        invocation({
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
          payload: { ...basePayload, locator: 'http://example.com/unsafe' },
        }),
      ),
      test.run(
        invocation({
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
          payload: { ...basePayload, locator: 'https://user:secret@example.com/private' },
        }),
      ),
      test.run(
        invocation({
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
          payload: { ...basePayload, kind: 'commit' },
        }),
      ),
      test.run(
        invocation({
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
          payload: { ...basePayload, sessionId: 'other-session' },
        }),
      ),
    ])
    expect(results.every((result) => !result.ok)).toBe(true)
    expect(test.resourceUpserts()).toEqual([])

    const listOnly = harness([OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES])
    const undeclared = await listOnly.run(
      invocation({
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
        payload: basePayload,
      }),
    )
    expect(undeclared).toMatchObject({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_METHOD },
    })
  })
})
