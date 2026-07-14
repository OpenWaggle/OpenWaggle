import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validWorkflow,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

describe('package release workflow security validation', () => {
  it('rejects token fallback and staged npm publishing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(
        projectRoot,
        `${validWorkflow}\nenv:\n  NPM_TOKEN: forbidden\n  NODE_AUTH_TOKEN: forbidden\n- run: npm stage publish\n`,
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml must not use npm token fallback authentication.',
          '.github/workflows/package-release.yml must publish directly, never use npm stage publish.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects a modified dedicated publication command and disabled provenance', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replaceAll(
        'node scripts/package-release-publish.ts "$TARBALL"',
        'node scripts/package-release-publish.ts . --provenance=false',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml must invoke only the dedicated publication command in publish-bases and publish-dependents.',
          '.github/workflows/package-release.yml must keep npm trusted-publishing provenance enabled.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects stale action majors and overprivileged secure publication jobs', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace('googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7', 'googleapis/release-please-action@v5')
        .replaceAll('actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10', 'actions/checkout@v6')
        .replaceAll('actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', 'actions/setup-node@v6')
        .replaceAll('pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1', 'pnpm/action-setup@v4')
        .replace('      pull-requests: write', '      issues: write\n      pull-requests: write')
        .replaceAll('          package-manager-cache: false\n', '')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml must execute googleapis/release-please-action at its approved immutable v5 SHA.',
          '.github/workflows/package-release.yml must execute actions/checkout at its approved immutable v6 SHA.',
          '.github/workflows/package-release.yml must execute actions/setup-node at its approved immutable v6 SHA.',
          '.github/workflows/package-release.yml must execute pnpm/action-setup at its approved immutable v4 SHA.',
          '.github/workflows/package-release.yml release-please must not grant issues: write.',
          '.github/workflows/package-release.yml publish-bases must disable setup-node package-manager caching.',
          '.github/workflows/package-release.yml publish-dependents must disable setup-node package-manager caching.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects an unknown mutable action injected into an OIDC publication job', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        '    steps:\n      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6',
        '    steps:\n      - uses: attacker/action@main # v1\n      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6',
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

  it('rejects an unknown mutable reusable workflow reference', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        'jobs:\n',
        'jobs:\n  injected-reusable-workflow:\n    uses: attacker/workflow@v1 # v1\n',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must pin every uses reference to a full 40-character lowercase commit SHA: attacker/workflow@v1.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects a 40-character action ref containing uppercase hexadecimal', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const uppercaseRef = '45996ED1F6D02564A971A2FA1B5860E934307CF7'
      const invalidWorkflow = validWorkflow.replace(
        '45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5',
        `${uppercaseRef} # v5`,
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        `.github/workflows/package-release.yml must pin every uses reference to a full 40-character lowercase commit SHA: googleapis/release-please-action@${uppercaseRef}.`,
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects an immutable expected action without its version comment', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        'googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5',
        'googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml googleapis/release-please-action uses must retain the approved # v5 comment.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('ignores mutable uses text in comments and shell no-ops', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const workflow = validWorkflow.replace(
        '      - uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5',
        "      # uses: attacker/comment-only@main # v1\n      - run: |\n          echo 'uses: attacker/no-op@main # v1'\n      - uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5",
      )
      await writeMinimalPackageReleaseProject(projectRoot, workflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects required actions that exist only in comments', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        '        uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5',
        '        run: true\n        # uses: googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must execute googleapis/release-please-action at its approved immutable v5 SHA.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects commented-out exact-tarball validation', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const dependentJobStart = validWorkflow.indexOf('  publish-dependents:')
      if (dependentJobStart === -1) {
        throw new Error('Expected publish-dependents in the valid workflow fixture.')
      }
      const invalidWorkflow = `${validWorkflow.slice(0, dependentJobStart)}${validWorkflow
        .slice(dependentJobStart)
        .replace('(cd "$ARTIFACT_DIR" && sha256sum --check SHA256SUMS)', '# sha256sum --check SHA256SUMS')}`
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml publish-dependents must checksum and inspect the exact tarball.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects exact-tarball validation replaced by no-op output', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const dependentJobStart = validWorkflow.indexOf('  publish-dependents:')
      if (dependentJobStart === -1) {
        throw new Error('Expected publish-dependents in the valid workflow fixture.')
      }
      const invalidWorkflow = `${validWorkflow.slice(0, dependentJobStart)}${validWorkflow
        .slice(dependentJobStart)
        .replace(
          '(cd "$ARTIFACT_DIR" && sha256sum --check SHA256SUMS)',
          "echo 'sha256sum --check SHA256SUMS'",
        )}`
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml publish-dependents must checksum and inspect the exact tarball.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects fail-open shell commands', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace('run: pnpm check', 'run: pnpm check || true')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must not use fail-open shell commands.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects required validation commands replaced by no-op output', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replaceAll('run: pnpm check', 'run: echo pnpm check')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must execute pnpm check.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects continue-on-error on release steps', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow.replace(
        '      - run: pnpm package-release:validate',
        '      - run: pnpm package-release:validate\n        continue-on-error: true',
      )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml must not use continue-on-error.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})
