import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validWorkflow,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

async function validateWorkflowWithout(workflowFragment: string, replacement: string) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
  try {
    await writeMinimalPackageReleaseProject(
      projectRoot,
      validWorkflow.replace(workflowFragment, replacement),
    )
    return await validatePackageReleaseFiles(projectRoot)
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true })
  }
}

describe('package release Yarn recovery validation', () => {
  it('rejects recovery smoke that allows Yarn CI immutable installs', async () => {
    const result = await validateWorkflowWithout(
      "          OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun'\n          YARN_ENABLE_IMMUTABLE_INSTALLS: 'false'",
      "          OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun'",
    )

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml release-qa must disable Yarn immutable installs for lockfile-free packed consumers.',
    )
  })

  it('rejects full release checks that allow Yarn CI immutable installs', async () => {
    const result = await validateWorkflowWithout(
      "        env:\n          YARN_ENABLE_IMMUTABLE_INSTALLS: 'false'\n        run: pnpm check",
      '        run: pnpm check',
    )

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml release-qa full checks must disable Yarn immutable installs for lockfile-free packed consumers.',
    )
  })
})
