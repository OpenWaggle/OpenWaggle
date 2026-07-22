import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validWorkflow,
  writeJson,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('package release validation', () => {
  it('accepts the repository package release workflow foundation', async () => {
    const result = await validatePackageReleaseFiles(process.cwd())

    expect(result.violations).toEqual([])
  })

  it('accepts an empty manifest with source packages at the 0.0.0 baseline', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(
        projectRoot,
        validWorkflow,
        '0.0.0',
        'bootstrap',
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects pre-1 breaking changes that would bump the major version', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(
        projectRoot,
        validWorkflow,
      )
      const configPath = path.join(projectRoot, 'release-please-config.json')
      const config: unknown = JSON.parse(await fs.readFile(configPath, 'utf8'))
      if (!isJsonObject(config)) {
        throw new Error('Expected release config fixture to be an object.')
      }
      const { ['bump-minor-pre-major']: _, ...invalidConfig } = config
      await writeJson(configPath, invalidConfig)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        'release-please-config.json must minor-bump pre-1 breaking changes.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects Release Please config that can omit local dependent patch bumps', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(projectRoot, validWorkflow)
      const configPath = path.join(projectRoot, 'release-please-config.json')
      const config: unknown = JSON.parse(await fs.readFile(configPath, 'utf8'))
      if (!isJsonObject(config)) {
        throw new Error('Expected release config fixture to be an object.')
      }
      const { ['always-link-local']: _, ...invalidConfig } = config
      await writeJson(configPath, invalidConfig)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        'release-please-config.json must patch-bump local dependents when base packages release.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects a grouped Release Please title that cannot pass package commit policy', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(projectRoot, validWorkflow)
      const configPath = path.join(projectRoot, 'release-please-config.json')
      const config: unknown = JSON.parse(await fs.readFile(configPath, 'utf8'))
      if (!isJsonObject(config)) {
        throw new Error('Expected release config fixture to be an object.')
      }
      const { ['group-pull-request-title-pattern']: _, ...invalidConfig } = config
      await writeJson(configPath, invalidConfig)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        'release-please-config.json must generate the policy-compatible coordinated release title.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects a root check script that skips package smoke validation', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(
        projectRoot,
        validWorkflow,
      )
      await writeJson(path.join(projectRoot, 'package.json'), {
        devDependencies: {
          'release-please': '17.6.0',
        },
        scripts: {
          check: 'pnpm typecheck && pnpm lint',
        },
      })

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain('package.json scripts.check must run pnpm package:smoke.')
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects an unpinned Release Please runtime', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(projectRoot, validWorkflow)
      const packageJsonPath = path.join(projectRoot, 'package.json')
      const packageJson: unknown = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
      if (!isJsonObject(packageJson)) {
        throw new Error('Expected package fixture to be an object.')
      }
      await writeJson(packageJsonPath, {
        ...packageJson,
        devDependencies: {
          'release-please': '^17.6.0',
        },
      })

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        'package.json must pin release-please 17.6.0 for deterministic preflight contracts.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects package metadata that breaks the Node floor or dependent release edges', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(projectRoot, validWorkflow)
      const reactPackagePath = path.join(projectRoot, 'packages/extension-react/package.json')
      await writeJson(reactPackagePath, {
        name: '@openwaggle/extension-react',
        version: '0.1.0',
        engines: { node: '>=24' },
        dependencies: {},
        publishConfig: { access: 'public' },
        files: ['dist', 'dist-cjs', 'CHANGELOG.md', 'README.md'],
      })

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          'packages/extension-react/package.json must require Node.js >=22.19.0.',
          'packages/extension-react/package.json must depend on @openwaggle/extension-sdk through workspace:^.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('accepts Release Please-bumped package versions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(
        projectRoot,
        validWorkflow,
        '0.2.0',
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})
