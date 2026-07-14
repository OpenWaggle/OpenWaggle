import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validWorkflow,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

describe('package release workflow validation', () => {
  it('rejects mutable uses references hidden in flow-style steps', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        '    steps:\n      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6',
        "    steps:\n      - { uses: 'attacker/action@main' }\n      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6",
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must pin every uses reference to a full 40-character lowercase commit SHA: attacker/action@main.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects required QA commands wrapped in multiline exit steps', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        '      - run: pnpm check',
        '      - run: |\n          pnpm check\n          exit 0',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must execute pnpm check.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('does not accept required QA commands from a different job', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        '      - run: pnpm package-release:validate',
        '      - run: echo skipped-validator',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must execute pnpm package-release:validate.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects conditional, shell-overridden, or fail-open required QA steps', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace('      - run: pnpm package-release:validate', '      - run: pnpm package-release:validate\n        if: always()')
        .replace('      - run: pnpm check', '      - run: pnpm check\n        shell: bash')
        .replace('      - run: pnpm build:packages', '      - run: pnpm build:packages\n        continue-on-error: false')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(expect.arrayContaining([
        '.github/workflows/package-release.yml must execute pnpm package-release:validate.',
        '.github/workflows/package-release.yml must execute pnpm check.',
        '.github/workflows/package-release.yml must execute pnpm build:packages.',
      ]))
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects malformed package release workflow YAML', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(projectRoot, `${validWorkflow}\njobs: [unterminated`)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations.some((violation) => violation.startsWith(
        '.github/workflows/package-release.yml must contain valid YAML:',
      ))).toBe(true)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects release QA without pinned Chromium and browser-enabled package smoke', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace('pnpm exec playwright install chromium', 'pnpm exec playwright install firefox')
        .replace("OPENWAGGLE_PACKAGE_BROWSER_SMOKE: '1'", "OPENWAGGLE_PACKAGE_BROWSER_SMOKE: '0'")
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(expect.arrayContaining([
        '.github/workflows/package-release.yml release-qa must install Chromium with pinned project Playwright tooling.',
        '.github/workflows/package-release.yml release-qa must run browser-enabled package smoke on every Node matrix entry.',
      ]))
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects workflow and publication permissions beyond least privilege', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace(
          'permissions:\n  contents: read',
          'permissions:\n  contents: read\n  actions: write',
        )
        .replace(
          '    permissions:\n      id-token: write',
          '    permissions:\n      id-token: write\n      packages: write',
        )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml must grant only contents: read by default.',
          '.github/workflows/package-release.yml publish-bases must grant only id-token: write.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects workflows that omit package paths or either exact-head release PR CI path', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace('      - packages/pi-waggle/**\n', '')
        .replace('event=pull_request&branch=${HEAD_REF}', 'event=workflow_dispatch&branch=${HEAD_REF}')
        .replace('.head_sha == $sha and .event == "pull_request"', '.head_sha == $sha')
        .replace('actions/workflows/ci.yml/dispatches', 'actions/workflows/other.yml/dispatches')
        .replace('inputs: {head_sha: $sha}', 'inputs: {head_sha: $ref}')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml must scope push releases to packages/pi-waggle/**.',
          '.github/workflows/package-release.yml must find PR-associated ci.yml runs for Release Please PRs.',
          '.github/workflows/package-release.yml must select PR-associated CI by the exact release PR head SHA.',
          '.github/workflows/package-release.yml must fall back to dispatching ci.yml for Release Please PRs.',
          '.github/workflows/package-release.yml must dispatch fallback CI with the exact release PR head SHA.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects release PR CI handling that is not idempotent across valid run states', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace('RUN_CONCLUSION" = "action_required"', 'RUN_CONCLUSION" = "success"')
        .replace('RUN_STATUS" != "completed"', 'RUN_STATUS" = "completed"')
        .replace('FINAL_CONCLUSION" = "success"', 'FINAL_CONCLUSION" = "failure"')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must safely rerun, watch, or accept exact-head release PR CI based on its current state.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects workflows without exact per-package release, recovery, and tarball gates', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace("steps.release.outputs['packages/extension-react--tag_name']", 'github.ref_name')
        .replace('sha256sum --check SHA256SUMS', 'echo unchecked')
        .replace('      - publish-bases', '      - release-plan')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml must use Release Please tag/version/SHA outputs for packages/extension-react.',
          '.github/workflows/package-release.yml must checksum the exact tarball before publication.',
          '.github/workflows/package-release.yml must publish dependent packages after base packages.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects a publication job that weakens its trusted exact-tarball gate', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const dependentJobStart = validWorkflow.indexOf('  publish-dependents:')
      if (dependentJobStart === -1) {
        throw new Error('Expected publish-dependents in the valid workflow fixture.')
      }
      const invalidWorkflow = `${validWorkflow.slice(0, dependentJobStart)}${validWorkflow
        .slice(dependentJobStart)
        .replace('node-version: 24.14.0', 'node-version: 24.13.0')
        .replace('ACTIONS_ID_TOKEN_REQUEST_URL', 'MISSING_OIDC_REQUEST_URL')
        .replace('sha256sum --check SHA256SUMS', 'echo unchecked')}`
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml publish-dependents must pin Node 24.14.0 and verify npm 11.9.0 before publication.',
          '.github/workflows/package-release.yml publish-dependents must verify the GitHub OIDC environment.',
          '.github/workflows/package-release.yml publish-dependents must checksum and inspect the exact tarball.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects replaceable recovery tags and dependent jobs blocked by absent bases', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace('ref: refs/tags/${{ inputs.package_tag }}', 'ref: ${{ inputs.package_tag }}')
        .replace('git ls-remote --exit-code origin "refs/tags/$RECOVERY_TAG"', 'echo unchecked-tag')
        .replace('RELEASE_JSON=$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag")', 'RELEASE_JSON={}')
        .replace('"$actual_version" != "$version"', 'false')
        .replaceAll('is already published.', 'may be replaced.')
        .replaceAll('always()', 'success()')
        .replace(
          "(needs.publish-bases.result == 'success' || needs.publish-bases.result == 'skipped')",
          'true',
        )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml recovery must checkout the exact tag ref.',
          '.github/workflows/package-release.yml recovery must verify the remote GitHub tag SHA.',
          '.github/workflows/package-release.yml recovery must verify source package version correspondence.',
          '.github/workflows/package-release.yml recovery must verify the exact GitHub Release.',
          '.github/workflows/package-release.yml recovery must refuse already-published versions.',
          '.github/workflows/package-release.yml dependents must run after skipped base publication jobs.',
          '.github/workflows/package-release.yml dependents must stop after failed base publication.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects consumer smoke matrices that can skip a Node line or package manager', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace('          - 22.19.0\n', '')
        .replace('npm install --global npm@11.18.0', 'npm install --global npm@latest')
        .replaceAll('version: 11.6.0', 'version: latest')
        .replace('corepack install --global yarn@4.17.1', 'true')
        .replace('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6', 'true')
        .replace(
          "OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun'",
          "OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm'",
        )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml release-qa must smoke consumers on Node 22.19.0 and Node 24.',
          '.github/workflows/package-release.yml release-qa must pin npm 11.18.0.',
          '.github/workflows/package-release.yml release-qa must pin pnpm 11.6.0.',
          '.github/workflows/package-release.yml release-qa must install Yarn 4.17.1.',
          '.github/workflows/package-release.yml must execute oven-sh/setup-bun at its approved immutable v2 SHA.',
          '.github/workflows/package-release.yml release-qa must require npm, pnpm, Yarn, and Bun package consumers.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects Yarn version checks that run inside the pnpm workspace', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        'test "$(cd "$RUNNER_TEMP" && yarn --version)" = "4.17.1"',
        'test "$(yarn --version)" = "4.17.1"',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml release-qa must verify Yarn 4.17.1 outside the pnpm workspace before smoke testing.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})
