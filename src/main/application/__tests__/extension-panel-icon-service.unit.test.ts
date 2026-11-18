import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import {
  type ExtensionPanelIconRequest,
  type ExtensionPanelIconResolution,
  ExtensionPanelIconResolver,
} from '../../ports/extension-panel-icon-resolver'
import { listExtensionContributionRegistryView } from '../extension-contribution-registry-service'
import { listExtensionContributionRegistryViewWithPanelIcons } from '../extension-panel-icon-service'
import {
  makeContributionRegistryTestLayer,
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const LUCIDE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>'

const panel = {
  runtime: 'federated-module',
  execution: 'frame',
  entry: 'dist/index.js',
} as const

const extensionPackage = makePackage({
  id: 'issues',
  name: 'Issues',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  contributions: {
    routes: [{ id: 'issues.route', title: 'Issues route', ...panel }],
    sidePanels: [
      { id: 'issues.lucide', title: 'Lucide panel', icon: 'ticket', ...panel },
      { id: 'issues.svg', title: 'Broken panel', icon: { svg: 'assets/broken.svg' }, ...panel },
      { id: 'issues.plain', title: 'Plain panel', ...panel },
    ],
  },
})

function resolverLayer(
  resolve: (request: ExtensionPanelIconRequest) => ExtensionPanelIconResolution,
) {
  const spy = vi.fn(resolve)
  return {
    spy,
    layer: Layer.succeed(ExtensionPanelIconResolver, {
      resolve: (request) => Effect.sync(() => spy(request)),
    }),
  }
}

function entryById(entries: readonly { readonly contributionId: string }[], id: string) {
  const entry = entries.find((candidate) => candidate.contributionId === id)
  if (!entry) throw new Error(`Missing entry ${id}`)
  return entry
}

describe('listExtensionContributionRegistryViewWithPanelIcons', () => {
  it('resolves declared side panel icons and reports unusable ones on the entry', async () => {
    const resolver = resolverLayer((request) =>
      typeof request.icon === 'string'
        ? { status: 'resolved', icon: { source: 'lucide', svg: LUCIDE_SVG } }
        : {
            status: 'invalid',
            message: 'The SVG icon file does not exist.',
            path: request.icon.svg,
          },
    )

    const view = await Effect.runPromise(
      listExtensionContributionRegistryViewWithPanelIcons({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(
          Layer.merge(
            makeContributionRegistryTestLayer({
              packages: [extensionPackage],
              lifecycles: [makeLifecycle(extensionPackage)],
            }),
            resolver.layer,
          ),
        ),
      ),
    )

    const lucide = view.entries.find((entry) => entry.contributionId === 'issues.lucide')
    const broken = view.entries.find((entry) => entry.contributionId === 'issues.svg')
    const plain = view.entries.find((entry) => entry.contributionId === 'issues.plain')
    const route = view.entries.find((entry) => entry.contributionId === 'issues.route')

    expect(lucide?.icon).toEqual({ source: 'lucide', svg: LUCIDE_SVG })
    expect(lucide?.diagnostics).toEqual([])
    expect(broken?.icon).toBeUndefined()
    expect(broken?.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'panel-icon-invalid',
        message:
          'Side panel "Broken panel" shows a letter tile because its icon is unusable: The SVG icon file does not exist.',
        path: 'assets/broken.svg',
      },
    ])
    expect(view.diagnostics).toEqual(broken?.diagnostics)
    expect(plain).toBeDefined()
    expect(plain?.icon).toBeUndefined()
    expect(plain?.diagnostics).toEqual([])
    expect(route?.icon).toBeUndefined()
    expect(resolver.spy).toHaveBeenCalledTimes(2)
    expect(resolver.spy).toHaveBeenCalledWith({
      packagePath: extensionPackage.packagePath,
      contentHash: extensionPackage.contentHash,
      icon: 'ticket',
    })
    expect(entryById(view.entries, 'issues.lucide')).not.toHaveProperty('iconDeclaration')
  })

  it('leaves the plain registry view free of icon work', async () => {
    const view = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(
          makeContributionRegistryTestLayer({
            packages: [extensionPackage],
            lifecycles: [makeLifecycle(extensionPackage)],
          }),
        ),
      ),
    )

    expect(entryById(view.entries, 'issues.lucide')).not.toHaveProperty('icon')
  })
})
