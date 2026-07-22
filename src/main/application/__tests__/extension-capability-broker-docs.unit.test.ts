import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import { BROKER_EXTENSION_ID, runBroker, TIMESTAMP } from './extension-capability-broker-test-utils'
import { makeLifecycle, makePackage } from './extension-contribution-registry-test-utils'

const DOCS_CONTRIBUTION_ID = 'openwaggle.docs.discover'

function makeDocsBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Docs Broker Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        methods: [
          OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
          OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
        ],
        scopes: ['app', 'project'],
      },
    ],
    contributions: {
      commands: [
        {
          id: DOCS_CONTRIBUTION_ID,
          title: 'Discover Docs',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
          methods: [
            OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
            OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
          ],
        },
      ],
    },
  })
}

async function withTempProjects(
  run: (paths: {
    readonly otherProjectPath: string
    readonly projectPath: string
  }) => Promise<void>,
) {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-docs-scope-'))
  const projectPath = path.join(rootPath, 'project')
  const otherProjectPath = path.join(rootPath, 'other-project')
  await fs.mkdir(projectPath, { recursive: true })
  await fs.mkdir(otherProjectPath, { recursive: true })

  try {
    await run({ otherProjectPath, projectPath })
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true })
  }
}

describe('invokeExtensionCapability docs capability', () => {
  it('discovers installed docs metadata through the typed OpenWaggle docs capability', async () => {
    const extensionPackage = makeDocsBrokerPackage()
    const result = await runBroker({
      invocation: {
        extensionId: BROKER_EXTENSION_ID,
        contributionId: DOCS_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
        scope: { kind: 'app' },
        payload: { includeExtensions: false },
      },
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
        docs: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          bundlePath: '/tmp/openwaggle-docs',
          firstPartyTopics: [],
          extensionTopics: [],
          diagnostics: [],
        },
      },
      audit: {
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: TIMESTAMP,
      },
    })
  })

  it('defaults project docs discovery to the invocation project scope', async () => {
    await withTempProjects(async ({ projectPath }) => {
      const extensionPackage = makeDocsBrokerPackage()
      const result = await runBroker({
        invocation: {
          extensionId: BROKER_EXTENSION_ID,
          contributionId: DOCS_CONTRIBUTION_ID,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
          scope: { kind: 'project', projectPath },
          payload: { includeExtensions: false },
        },
        packages: [extensionPackage],
        lifecycles: [makeLifecycle(extensionPackage)],
        currentProjectPath: projectPath,
      })

      expect(result).toMatchObject({
        ok: true,
        value: {
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
          docs: {
            extensionTopics: [],
          },
        },
      })
    })
  })

  it('rejects docs discovery project paths outside the invocation project scope', async () => {
    await withTempProjects(async ({ otherProjectPath, projectPath }) => {
      const extensionPackage = makeDocsBrokerPackage()
      const result = await runBroker({
        invocation: {
          extensionId: BROKER_EXTENSION_ID,
          contributionId: DOCS_CONTRIBUTION_ID,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
          scope: { kind: 'project', projectPath },
          payload: { includeExtensions: false, projectPaths: [otherProjectPath] },
        },
        packages: [extensionPackage],
        lifecycles: [makeLifecycle(extensionPackage)],
        currentProjectPath: projectPath,
      })

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
          message: expect.stringContaining(otherProjectPath),
        },
        audit: {
          outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.REJECTED,
          failureCode: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
          timestamp: TIMESTAMP,
        },
      })
    })
  })
})
