import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validCiWorkflow,
  validWorkflow,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

const temporaryDirectories: string[] = []

function replaceRequired(source: string, target: string, replacement: string) {
  expect(source).toContain(target)
  return source.replace(target, replacement)
}

async function temporaryProject(workflow = validWorkflow, ciWorkflow = validCiWorkflow) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
  temporaryDirectories.push(projectRoot)
  await writeMinimalPackageReleaseProject(projectRoot, workflow, '0.1.0', 'released', ciWorkflow)
  return projectRoot
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { force: true, recursive: true }),
    ),
  )
})

describe('package release workflow validation', () => {
  it.each([
    ['actions permission', '      actions: write', '      actions: read'],
    [
      'exact-head dispatch',
      'repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/dispatches',
      'repos/$GITHUB_REPOSITORY/actions/workflows/other.yml/dispatches',
    ],
    ['versioned docs synchronization', 'pnpm package-docs:update', 'echo skipped-docs-update'],
    ['successful completion wait', 'gh run watch "$RUN_ID" --exit-status', 'echo skipped-wait'],
  ])('rejects weakened Release Please CI coordination through %s', async (_name, target, replacement) => {
    const invalidWorkflow = replaceRequired(validWorkflow, target, replacement)
    const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must match its exact fail-closed AST contract.',
    )
  })

  it('rejects release planning without its own exact Node 24.14.0 setup and version guard', async () => {
    const invalidWorkflow = replaceRequired(
      validWorkflow,
      'node --version | grep -Fx v24.14.0',
      'node --version | grep -Fx v24.13.0',
    )
    const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must match its exact fail-closed AST contract.',
    )
  })

  it('rejects artifact preparation that does not smoke the canonical tarball directory before attestation', async () => {
    const invalidCi = replaceRequired(
      validCiWorkflow,
      'pnpm package:smoke --tarball-dir "$RUNNER_TEMP/package-release-artifacts"',
      'pnpm package:smoke',
    )
    const result = await validatePackageReleaseFiles(
      await temporaryProject(validWorkflow, invalidCi),
    )

    expect(result.violations).toContain(
      'CI workflow must match its exact fail-closed AST contract.',
    )
  })

  it('rejects duplicate Node 24 release-PR rehearsal instead of canonical artifact smoke', async () => {
    const invalidCi = replaceRequired(
      validCiWorkflow,
      "matrix.node == '22.19.0' || !startsWith(github.head_ref || github.ref_name, 'release-please--branches--main')",
      'always()',
    )
    const result = await validatePackageReleaseFiles(
      await temporaryProject(validWorkflow, invalidCi),
    )

    expect(result.violations).toContain(
      'CI workflow must match its exact fail-closed AST contract.',
    )
  })

  it('rejects CI that weakens the always-present, exact-runtime package gate', async () => {
    const invalidCi = validCiWorkflow
      .replace('name: Package Release Gate', 'name: Optional package checks')
      .replace('          - 22.19.0\n', '')
      .replace('pnpm website:build', 'echo skipped-website')
      .replace("OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun'", "OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm'")
      .replace('if: ${{ always() }}', 'if: ${{ success() }}')
    const result = await validatePackageReleaseFiles(await temporaryProject(validWorkflow, invalidCi))

    expect(result.violations).toEqual(expect.arrayContaining([
      '.github/workflows/ci.yml must expose the always-present Package Release Gate status.',
      '.github/workflows/ci.yml must rehearse exact Node 22.19.0 and 24.14.0 runtimes.',
      '.github/workflows/ci.yml Package Release Candidate must always report a conclusion.',
    ]))
  })

  it('rejects dispatched Release Please validation that skips artifact preparation', async () => {
    const invalidCi = validCiWorkflow
      .replace('          REF_NAME: ${{ github.ref_name }}\n', '')
      .replace('${{ github.head_ref || github.ref_name }}', '${{ github.head_ref }}')
    const result = await validatePackageReleaseFiles(await temporaryProject(validWorkflow, invalidCi))

    expect(result.violations).toEqual(expect.arrayContaining([
      '.github/workflows/ci.yml must classify exact-head Release Please dispatches.',
      '.github/workflows/ci.yml Package Release Candidate must classify pull-request and dispatched branches.',
    ]))
  })

  it('rejects release artifacts without tree planning, hash validation, and provenance', async () => {
    const invalidCi = validCiWorkflow
      .replace('scripts/package-release-plan.ts', 'scripts/skipped-plan.ts')
      .replace('scripts/package-release-artifacts.ts prepare', 'scripts/skipped-artifacts.ts')
      .replace('actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a', 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10')
    const result = await validatePackageReleaseFiles(await temporaryProject(validWorkflow, invalidCi))

    expect(result.violations).toEqual(expect.arrayContaining([
      '.github/workflows/ci.yml must resolve the exact Release Please tree plan.',
      '.github/workflows/ci.yml must build and verify immutable tarballs before merge.',
      '.github/workflows/ci.yml must attest package tarballs and their manifest.',
    ]))
  })

  it('rejects post-merge rebuilding, testing, or docs generation', async () => {
    const invalidWorkflow = validWorkflow.replace(
      '      - name: Install and verify pinned trusted-publishing npm',
      '      - run: pnpm install --frozen-lockfile\n      - run: pnpm check\n      - run: pnpm build:packages\n      - run: pnpm docs:generate\n\n      - name: Install and verify pinned trusted-publishing npm',
    )
    const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

    expect(result.violations).toEqual(expect.arrayContaining([
      '.github/workflows/package-release.yml post-merge publication must not execute pnpm install.',
      '.github/workflows/package-release.yml post-merge publication must not execute pnpm check.',
      '.github/workflows/package-release.yml post-merge publication must not execute build:packages.',
      '.github/workflows/package-release.yml post-merge publication must not execute docs:generate.',
    ]))
  })

  it('rejects shallow post-merge release planning', async () => {
    const invalidWorkflow = validWorkflow.replace(
      '          fetch-depth: 0\n          ref: ${{ github.sha }}',
      '          fetch-depth: 2\n          ref: ${{ github.sha }}',
    )
    const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml release planning must fetch full history for multi-commit rebase merges.',
    )
  })

  it('rejects malformed workflow YAML', async () => {
    const result = await validatePackageReleaseFiles(
      await temporaryProject(`${validWorkflow}\njobs: [unterminated`),
    )

    expect(result.violations.some((violation) =>
      violation.startsWith('.github/workflows/package-release.yml must contain valid YAML:'),
    )).toBe(true)
  })
})
