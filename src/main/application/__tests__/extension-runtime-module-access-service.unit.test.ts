import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { OpenWaggleExtensionManifest } from '@shared/schemas/extensions'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import { isExtensionRuntimeModuleAccessAllowed } from '../extension-runtime-module-access-service'
import {
  makeContributionRegistryTestLayer,
  makeLifecycle,
  makePackage,
  makeProjectOverride,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const ROUTE_CONTRIBUTIONS = {
  routes: [
    {
      id: 'sample.route',
      title: 'Sample route',
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entry: 'dist/index.js',
    },
  ],
} satisfies NonNullable<OpenWaggleExtensionManifest['contributions']>

function contentHash(extensionPackage: DiscoveredExtensionPackage) {
  if (extensionPackage.contentHash === null) {
    throw new Error('Expected test package to have a content hash.')
  }
  return extensionPackage.contentHash
}

function runAccessCheck(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly trusted?: boolean
  readonly enabled?: boolean
  readonly projectDisabled?: boolean
  readonly contentHash?: string
  readonly sessionId?: string
}) {
  const lifecycle = makeLifecycle(input.extensionPackage, {
    trusted: input.trusted,
    enabled: input.enabled,
  })
  const projectOverrides =
    input.projectDisabled === true
      ? [
          makeProjectOverride({
            extensionPackage: input.extensionPackage,
            projectPath: PROJECT_PATH,
            disabled: true,
          }),
        ]
      : []

  return Effect.runPromise(
    isExtensionRuntimeModuleAccessAllowed({
      packagePath: input.extensionPackage.packagePath,
      contentHash: input.contentHash ?? contentHash(input.extensionPackage),
      projectPaths: [PROJECT_PATH],
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    }).pipe(
      Effect.provide(
        makeContributionRegistryTestLayer({
          packages: [input.extensionPackage],
          lifecycles: [lifecycle],
          projectOverrides,
        }),
      ),
    ),
  )
}

describe('isExtensionRuntimeModuleAccessAllowed', () => {
  it('allows currently eligible federated-module package files for requested projects', async () => {
    const extensionPackage = makePackage({
      id: 'sample-extension',
      name: 'Sample Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      contributions: ROUTE_CONTRIBUTIONS,
    })

    await expect(runAccessCheck({ extensionPackage })).resolves.toBe(true)
  })

  it('denies disabled, untrusted, and stale-hash package files', async () => {
    const extensionPackage = makePackage({
      id: 'sample-extension',
      name: 'Sample Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      contributions: ROUTE_CONTRIBUTIONS,
    })

    await expect(runAccessCheck({ extensionPackage, enabled: false })).resolves.toBe(false)
    await expect(runAccessCheck({ extensionPackage, trusted: false })).resolves.toBe(false)
    await expect(runAccessCheck({ extensionPackage, contentHash: 'stale' })).resolves.toBe(false)
  })

  it('denies package files once the package is absent from discovery', async () => {
    const extensionPackage = makePackage({
      id: 'sample-extension',
      name: 'Sample Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      contributions: ROUTE_CONTRIBUTIONS,
    })

    await expect(
      Effect.runPromise(
        isExtensionRuntimeModuleAccessAllowed({
          packagePath: extensionPackage.packagePath,
          contentHash: contentHash(extensionPackage),
          projectPaths: [PROJECT_PATH],
        }).pipe(
          Effect.provide(
            makeContributionRegistryTestLayer({
              packages: [],
              lifecycles: [makeLifecycle(extensionPackage)],
            }),
          ),
        ),
      ),
    ).resolves.toBe(false)
  })

  it('denies global package files when the requested project opted out', async () => {
    const extensionPackage = makePackage({
      id: 'sample-extension',
      name: 'Sample Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: ROUTE_CONTRIBUTIONS,
    })

    await expect(runAccessCheck({ extensionPackage, projectDisabled: true })).resolves.toBe(false)
  })

  it('allows session-targeted federated modules only for the matching session context', async () => {
    const extensionPackage = makePackage({
      id: 'sample-extension',
      name: 'Sample Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      contributions: {
        routes: ROUTE_CONTRIBUTIONS.routes.map((route) => ({
          ...route,
          target: { sessionIds: ['session-1'] },
        })),
      },
    })

    await expect(runAccessCheck({ extensionPackage })).resolves.toBe(false)
    await expect(runAccessCheck({ extensionPackage, sessionId: 'session-2' })).resolves.toBe(false)
    await expect(runAccessCheck({ extensionPackage, sessionId: 'session-1' })).resolves.toBe(true)
  })
})
