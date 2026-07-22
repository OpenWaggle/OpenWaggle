import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearExtensionContributionRegistryCacheForTests } from '../extension-contribution-registry-cache'
import {
  EXTENSION_PACKAGE_WORKFLOW,
  getExtensionPackageWriteProposalHash,
} from '../extension-package-workflow-model'
import {
  createOrUpdateExtensionPackage,
  proposeExtensionPackageWrite,
} from '../extension-package-workflow-service'
import { makePackage, PROJECT_PATH } from './extension-contribution-registry-test-utils'
import {
  AGENT_ACTOR,
  approvedWriteInput,
  GLOBAL_SCOPE,
  makeWorkflowHarness,
  PROJECT_SCOPE,
  packageFiles,
} from './extension-package-workflow-test-utils'

describe('extension package write proposal workflow', () => {
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
  })

  it('builds a user-reviewable package write proposal before approval', async () => {
    const extensionId = 'workflow-proposal-extension'
    const files = [
      ...packageFiles(extensionId),
      {
        relativePath: 'docs\\readme.md',
        content: '# Proposal\n',
      },
    ]
    const harness = makeWorkflowHarness({
      packages: [],
      lifecycle: null,
    })

    const proposal = await Effect.runPromise(
      proposeExtensionPackageWrite({
        extensionId,
        scope: PROJECT_SCOPE,
        mode: 'create',
        files,
        actor: AGENT_ACTOR,
        viewProjectPaths: [PROJECT_PATH],
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(proposal).toMatchObject({
      extensionId,
      scope: PROJECT_SCOPE,
      mode: 'create',
      operation: 'write:create',
      actor: AGENT_ACTOR,
      proposalHash: getExtensionPackageWriteProposalHash({
        extensionId,
        scope: PROJECT_SCOPE,
        mode: 'create',
        files,
      }),
      fileCount: files.length,
      requiresGlobalConfirmation: false,
      globalConfirmationRisk: null,
    })
    expect(proposal.files.map((file) => file.relativePath)).toEqual([
      'dist/index.js',
      'docs/readme.md',
      OPENWAGGLE_EXTENSION.MANIFEST_FILE,
      'src/index.ts',
    ])
    expect(proposal.files.every((file) => file.contentHash.length === 64)).toBe(true)
    expect(harness.getWrites()).toEqual([])
  })

  it('binds package write proposal hashes to unambiguous file boundaries', () => {
    const extensionId = 'workflow-hash-boundary-extension'
    const separator = OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR

    const oneFileHash = getExtensionPackageWriteProposalHash({
      extensionId,
      scope: PROJECT_SCOPE,
      mode: 'create',
      files: [
        {
          relativePath: 'a.js',
          content: `x${separator}file-path${separator}b.js${separator}file-content${separator}y`,
        },
      ],
    })
    const twoFileHash = getExtensionPackageWriteProposalHash({
      extensionId,
      scope: PROJECT_SCOPE,
      mode: 'create',
      files: [
        { relativePath: 'a.js', content: 'x' },
        { relativePath: 'b.js', content: 'y' },
      ],
    })

    expect(oneFileHash).not.toEqual(twoFileHash)
  })

  it('rejects direct extension actors before proposal hashes are issued', async () => {
    const extensionId = 'workflow-extension-actor-proposal'
    const harness = makeWorkflowHarness({
      packages: [],
      lifecycle: null,
    })

    await expect(
      Effect.runPromise(
        proposeExtensionPackageWrite({
          extensionId,
          scope: PROJECT_SCOPE,
          mode: 'create',
          files: packageFiles(extensionId),
          actor: { kind: 'extension', extensionId },
          viewProjectPaths: [PROJECT_PATH],
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow(EXTENSION_PACKAGE_WORKFLOW.ERROR.EXTENSION_ACTOR_REJECTED)
    expect(harness.getWrites()).toEqual([])
  })

  it('rejects package write proposals whose manifest id does not match the target extension id', async () => {
    const extensionId = 'workflow-manifest-identity-extension'
    const harness = makeWorkflowHarness({
      packages: [],
      lifecycle: null,
    })

    await expect(
      Effect.runPromise(
        proposeExtensionPackageWrite({
          extensionId,
          scope: PROJECT_SCOPE,
          mode: 'create',
          files: packageFiles('other-manifest-extension'),
          actor: AGENT_ACTOR,
          viewProjectPaths: [PROJECT_PATH],
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow(EXTENSION_PACKAGE_WORKFLOW.ERROR.MANIFEST_ID_MISMATCH)
    expect(harness.getWrites()).toEqual([])
  })

  it('rejects create/update proposals that do not match current package existence', async () => {
    const existingPackage = makePackage({
      id: 'workflow-mode-extension',
      name: 'Workflow Mode Extension',
      scope: PROJECT_SCOPE,
      contributions: { commands: [{ id: 'workflow-mode.run', title: 'Run Workflow Mode' }] },
    })
    const harness = makeWorkflowHarness({
      packages: [existingPackage],
      lifecycle: null,
    })

    await expect(
      Effect.runPromise(
        proposeExtensionPackageWrite({
          extensionId: existingPackage.id,
          scope: PROJECT_SCOPE,
          mode: 'create',
          files: packageFiles(existingPackage.id),
          actor: AGENT_ACTOR,
          viewProjectPaths: [PROJECT_PATH],
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow(EXTENSION_PACKAGE_WORKFLOW.ERROR.CREATE_TARGET_EXISTS)

    await expect(
      Effect.runPromise(
        proposeExtensionPackageWrite({
          extensionId: 'workflow-missing-extension',
          scope: PROJECT_SCOPE,
          mode: 'update',
          files: packageFiles('workflow-missing-extension'),
          actor: AGENT_ACTOR,
          viewProjectPaths: [PROJECT_PATH],
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow(EXTENSION_PACKAGE_WORKFLOW.ERROR.UPDATE_TARGET_MISSING)
    expect(harness.getWrites()).toEqual([])
  })

  it('creates a project-local package after the exact proposal hash is approved', async () => {
    const extensionPackage = makePackage({
      id: 'workflow-create-extension',
      name: 'Workflow Create Extension',
      scope: PROJECT_SCOPE,
      contributions: { commands: [{ id: 'workflow-create.run', title: 'Run Workflow Create' }] },
    })
    const harness = makeWorkflowHarness({
      packages: [],
      lifecycle: null,
      packageAfterWrite: extensionPackage,
    })

    const view = await Effect.runPromise(
      createOrUpdateExtensionPackage(
        approvedWriteInput({
          extensionId: extensionPackage.id,
          scope: extensionPackage.scope,
          mode: 'create',
          files: packageFiles(extensionPackage.id),
          actor: AGENT_ACTOR,
          viewProjectPaths: [PROJECT_PATH],
        }),
      ).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getWrites()).toHaveLength(1)
    expect(view.packages.map((extensionPackageView) => extensionPackageView.id)).toEqual([
      extensionPackage.id,
    ])
  })

  it('applies approved global extension writes only with the global-impact confirmation', async () => {
    const globalPackage = makePackage({
      id: 'global-workflow-confirmed-extension',
      name: 'Global Workflow Confirmed Extension',
      scope: GLOBAL_SCOPE,
      contributions: { commands: [{ id: 'global-workflow-confirmed.run', title: 'Run Global' }] },
    })
    const harness = makeWorkflowHarness({
      packages: [],
      lifecycle: null,
      packageAfterWrite: globalPackage,
    })

    await Effect.runPromise(
      createOrUpdateExtensionPackage(
        approvedWriteInput({
          extensionId: globalPackage.id,
          scope: globalPackage.scope,
          mode: 'create',
          files: packageFiles(globalPackage.id),
          actor: AGENT_ACTOR,
          viewProjectPaths: [PROJECT_PATH],
          includeGlobalConfirmation: true,
        }),
      ).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getWrites()).toHaveLength(1)
  })
})
