import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { withSessionResourceLock } from '../session-resource-lock'
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

function deferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve: () => resolve?.() }
}

describe('extension resource publication locking', () => {
  it('waits for in-flight image materialization before reading resource availability', async () => {
    const extensionPackage = makePackage({
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
    const test = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
    })
    const entered = deferred()
    const release = deferred()
    const materialization = Effect.runPromise(
      withSessionResourceLock(
        SessionId(SESSION_ID),
        Effect.promise(async () => {
          entered.resolve()
          await release.promise
        }),
      ),
    )
    await entered.promise

    const publication = test.run({
      extensionId: BROKER_EXTENSION_ID,
      contributionId: CONTRIBUTION_ID,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
      scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: SESSION_ID },
      payload: {
        key: 'diagram',
        title: 'Architecture diagram',
        kind: 'image',
        role: 'output',
        locator: 'https://images.example.com/diagram.png',
      },
    })
    await Promise.resolve()

    expect(test.resourceUpserts()).toEqual([])
    release.resolve()
    await Promise.all([materialization, publication])
    expect(test.resourceUpserts()).toHaveLength(1)
  })
})
