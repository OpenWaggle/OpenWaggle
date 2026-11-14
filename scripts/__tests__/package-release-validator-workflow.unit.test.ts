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
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  )
})

describe('package release workflow validation', () => {
  it('rejects eager JSON parsing of optional Release Please outputs', async () => {
    const invalidWorkflow = replaceRequired(
      validWorkflow,
      '${{ steps.release-pr.outputs.head_branch }}',
      '${{ fromJSON(steps.release.outputs.pr).headBranchName }}',
    )
    const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

    expect(result.violations).toContain(
      '.github/workflows/package-release.yml must not eagerly parse optional Release Please outputs.',
    )
  })

  it('rejects package publication without immutable recovery dispatch guards', async () => {
    const invalidWorkflow = validWorkflow
      .replace('  workflow_dispatch:\n', '  disabled_dispatch:\n')
      .replace('scripts/package-release-context.ts', 'scripts/unsafe-release-context.ts')
    const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

    expect(result.violations).toEqual(
      expect.arrayContaining([
        '.github/workflows/package-release.yml must expose an explicit package release recovery dispatch.',
        '.github/workflows/package-release.yml must resolve push and recovery identity through the typed release context.',
      ]),
    )
  })

  it('rejects a recovery resolver that no longer requires origin/main ancestry', async () => {
    const projectRoot = await temporaryProject()
    const contextPath = path.join(projectRoot, 'scripts/package-release-context.ts')
    const contextSource = await fs.readFile(
      path.join(process.cwd(), 'scripts/package-release-context.ts'),
      'utf8',
    )
    await fs.writeFile(
      contextPath,
      replaceRequired(contextSource, "'origin/main'", "'origin/untrusted'"),
      'utf8',
    )

    const result = await validatePackageReleaseFiles(projectRoot)

    expect(result.violations).toContain(
      'package-release-context.ts must require recovery commits to be reachable from origin/main.',
    )
  })

  it.each([
    ['actions permission', '      actions: write', '      actions: read'],
    [
      'exact-head dispatch',
      'repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/dispatches',
      'repos/$GITHUB_REPOSITORY/actions/workflows/other.yml/dispatches',
    ],
    ['versioned docs synchronization', 'bun run package-docs:update', 'echo skipped-docs-update'],
    // Release Please's version bump left the workspace versions in bun.lock stale.
    ['lockfile synchronization', 'bun install --lockfile-only', 'echo skipped-lockfile-update'],
    [
      'lockfile commit',
      'git add -A -- packages website/src/content bun.lock',
      'git add -A -- packages website/src/content',
    ],
    ['successful completion wait', 'gh run watch "$RUN_ID" --exit-status', 'echo skipped-wait'],
    [
      'generated head binding',
      'EXPECTED_HEAD_SHA: ${{ steps.docs.outputs.head_sha }}',
      'EXPECTED_HEAD_SHA: ${{ github.sha }}',
    ],
    ['generated head enforcement', 'test "$HEAD_SHA" = "$EXPECTED_HEAD_SHA"', 'echo "$HEAD_SHA"'],
  ])(
    'rejects weakened Release Please CI coordination through %s',
    async (_name, target, replacement) => {
      const invalidWorkflow = replaceRequired(validWorkflow, target, replacement)
      const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must match its exact fail-closed AST contract.',
      )
    },
  )

  it('accepts the merged release PR relabel after promotion', async () => {
    const result = await validatePackageReleaseFiles(await temporaryProject())

    expect(result.violations).toEqual([])
    expect(validWorkflow).toContain('  mark-release-tagged:\n')
  })

  it('rejects a workflow that leaves merged release PRs labelled autorelease: pending', async () => {
    const start = validWorkflow.indexOf('\n  mark-release-tagged:\n')
    expect(start).toBeGreaterThan(0)
    const result = await validatePackageReleaseFiles(
      await temporaryProject(`${validWorkflow.slice(0, start)}\n`),
    )

    expect(result.violations).toEqual(
      expect.arrayContaining([
        '.github/workflows/package-release.yml must match its exact fail-closed AST contract.',
        '.github/workflows/package-release.yml must mark the merged release PR tagged only after promotion creates every tag.',
        '.github/workflows/package-release.yml must relabel the merged release PR so later Release Please runs do not abort.',
      ]),
    )
  })

  it.each([
    [
      'before promotion succeeds',
      "needs.publish.result == 'success'",
      "needs.release-plan.result == 'success'",
    ],
    [
      'without removing the pending label',
      'labels/autorelease%3A%20pending',
      'labels/autorelease%3A%20snoozed',
    ],
    [
      'without adding the tagged label',
      'labels[]=autorelease: tagged',
      'labels[]=autorelease: released',
    ],
  ])('rejects relabelling the merged release PR %s', async (_name, target, replacement) => {
    const invalidWorkflow = replaceRequired(validWorkflow, target, replacement)
    const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

    expect(result.violations).toEqual(
      expect.arrayContaining([
        '.github/workflows/package-release.yml must match its exact fail-closed AST contract.',
      ]),
    )
    expect(result.violations.some((violation) => violation.includes('merged release PR'))).toBe(
      true,
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
      'bun run package:smoke --tarball-dir "$RUNNER_TEMP/package-release-artifacts"',
      'bun run package:smoke',
    )
    const result = await validatePackageReleaseFiles(
      await temporaryProject(validWorkflow, invalidCi),
    )

    expect(result.violations).toContain(
      'CI workflow must match its exact fail-closed AST contract.',
    )
  })

  it('rejects a package consumer rehearsal that runs on every change instead of package changes', async () => {
    const invalidCi = replaceRequired(
      validCiWorkflow,
      "needs.changes.outputs.package == 'true' || (github.head_ref || github.ref_name) == 'release-please--branches--main'",
      'always()',
    )
    const result = await validatePackageReleaseFiles(
      await temporaryProject(validWorkflow, invalidCi),
    )

    expect(result.violations).toContain(
      'CI workflow must match its exact fail-closed AST contract.',
    )
  })

  it('rejects prefix matching that lets lookalike branches trigger package rehearsal', async () => {
    const invalidCi = replaceRequired(
      validCiWorkflow,
      "(github.head_ref || github.ref_name) == 'release-please--branches--main'",
      "startsWith(github.head_ref || github.ref_name, 'release-please--branches--main')",
    )
    const result = await validatePackageReleaseFiles(
      await temporaryProject(validWorkflow, invalidCi),
    )

    expect(result.violations).toContain(
      '.github/workflows/ci.yml must use exact branch matching for Release Please rehearsal triggers.',
    )
  })

  it('rejects CI that weakens the always-present, exact-runtime package gate', async () => {
    const invalidCi = validCiWorkflow
      .replace('name: Package Release Gate', 'name: Optional package checks')
      .replace('node-version: 22.19.0', 'node-version: 20')
      .replace('bun run website:build', 'echo skipped-website')
      .replace(
        "OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun'",
        "OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm'",
      )
      .replace('if: ${{ always() }}', 'if: ${{ success() }}')
    const result = await validatePackageReleaseFiles(
      await temporaryProject(validWorkflow, invalidCi),
    )

    expect(result.violations).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml must expose the always-present Package Release Gate status.',
        '.github/workflows/ci.yml must rehearse the exact Node 22.19.0 runtime for package consumers.',
        '.github/workflows/ci.yml Package Release Candidate must always report a conclusion.',
      ]),
    )
  })

  it('rejects dispatched Release Please validation that skips artifact preparation', async () => {
    const invalidCi = validCiWorkflow
      .replace('          REF_NAME: ${{ github.ref_name }}\n', '')
      .replace('${{ github.head_ref || github.ref_name }}', '${{ github.head_ref }}')
    const result = await validatePackageReleaseFiles(
      await temporaryProject(validWorkflow, invalidCi),
    )

    expect(result.violations).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml must classify exact-head Release Please dispatches.',
        '.github/workflows/ci.yml Package Release Candidate must classify pull-request and dispatched branches.',
      ]),
    )
  })

  it('rejects release artifacts without tree planning, hash validation, and provenance', async () => {
    const invalidCi = validCiWorkflow
      .replace('scripts/package-release-plan.ts', 'scripts/skipped-plan.ts')
      .replace('scripts/package-release-artifacts.ts prepare', 'scripts/skipped-artifacts.ts')
      .replace(
        'actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a',
        'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
      )
    const result = await validatePackageReleaseFiles(
      await temporaryProject(validWorkflow, invalidCi),
    )

    expect(result.violations).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml must resolve the exact Release Please tree plan.',
        '.github/workflows/ci.yml must build and verify immutable tarballs before merge.',
        '.github/workflows/ci.yml must attest package tarballs and their manifest.',
      ]),
    )
  })

  it('rejects post-merge rebuilding, testing, or docs generation', async () => {
    const invalidWorkflow = validWorkflow.replace(
      '      - name: Install and verify pinned trusted-publishing npm',
      '      - run: bun install --frozen-lockfile\n      - run: bun run check\n      - run: bun run build:packages\n      - run: bun run docs:generate\n      - run: bunx tsc\n      - run: bun x vite build\n\n      - name: Install and verify pinned trusted-publishing npm',
    )
    const result = await validatePackageReleaseFiles(await temporaryProject(invalidWorkflow))

    expect(result.violations).toEqual(
      expect.arrayContaining([
        '.github/workflows/package-release.yml post-merge publication must not execute bun install.',
        '.github/workflows/package-release.yml post-merge publication must not execute bun run.',
        '.github/workflows/package-release.yml post-merge publication must not execute bunx.',
        '.github/workflows/package-release.yml post-merge publication must not execute bun x.',
        '.github/workflows/package-release.yml post-merge publication must not execute build:packages.',
        '.github/workflows/package-release.yml post-merge publication must not execute docs:generate.',
      ]),
    )
  })

  it('rejects shallow post-merge release planning', async () => {
    const invalidWorkflow = replaceRequired(
      validWorkflow,
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

    expect(
      result.violations.some((violation) =>
        violation.startsWith('.github/workflows/package-release.yml must contain valid YAML:'),
      ),
    ).toBe(true)
  })
})
