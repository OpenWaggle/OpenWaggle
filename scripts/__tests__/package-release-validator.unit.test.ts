import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePackageReleaseFiles } from '../package-release-validator'

const packageDirectories = [
  'packages/extension-sdk',
  'packages/extension-react',
  'packages/waggle-core',
  'packages/pi-waggle',
] as const

const packageNames = [
  '@openwaggle/extension-sdk',
  '@openwaggle/extension-react',
  '@openwaggle/waggle-core',
  '@openwaggle/pi-waggle',
] as const

async function writeFile(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeMinimalPackageReleaseProject(
  projectRoot: string,
  workflowText: string,
  version = '0.1.0',
) {
  await writeJson(path.join(projectRoot, 'release-please-config.json'), {
    'release-type': 'node',
    'include-component-in-tag': true,
    'include-v-in-tag': true,
    packages: {
      'packages/extension-sdk': {
        'package-name': '@openwaggle/extension-sdk',
        component: 'extension-sdk',
        'changelog-path': 'CHANGELOG.md',
      },
      'packages/extension-react': {
        'package-name': '@openwaggle/extension-react',
        component: 'extension-react',
        'changelog-path': 'CHANGELOG.md',
      },
      'packages/waggle-core': {
        'package-name': '@openwaggle/waggle-core',
        component: 'waggle-core',
        'changelog-path': 'CHANGELOG.md',
      },
      'packages/pi-waggle': {
        'package-name': '@openwaggle/pi-waggle',
        component: 'pi-waggle',
        'changelog-path': 'CHANGELOG.md',
      },
    },
    plugins: [{ type: 'node-workspace' }],
  })
  await writeJson(path.join(projectRoot, '.release-please-manifest.json'), {
    'packages/extension-sdk': version,
    'packages/extension-react': version,
    'packages/waggle-core': version,
    'packages/pi-waggle': version,
  })
  await writeJson(path.join(projectRoot, 'package.json'), {
    scripts: {
      check: 'pnpm typecheck && pnpm package:smoke',
    },
  })
  await writeFile(path.join(projectRoot, '.github/workflows/package-release.yml'), workflowText)

  for (const [index, packageDirectory] of packageDirectories.entries()) {
    await writeJson(path.join(projectRoot, packageDirectory, 'package.json'), {
      name: packageNames[index],
      version,
      publishConfig: {
        access: 'public',
      },
      files: ['dist', 'dist-cjs', 'CHANGELOG.md', 'README.md'],
    })
    await writeFile(path.join(projectRoot, packageDirectory, 'CHANGELOG.md'), '# Changelog\n')
  }
}

describe('package release validation', () => {
  it('accepts the repository package release workflow foundation', async () => {
    const result = await validatePackageReleaseFiles(process.cwd())

    expect(result.violations).toEqual([])
  })

  it('rejects token fallback and direct npm publishing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(
        projectRoot,
        `
name: Package Release
on:
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
  push:
    branches: [main]
permissions:
  id-token: write
jobs:
  publish:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
      - run: pnpm package-release:validate
      - run: pnpm check
      - run: pnpm build:packages
      - run: echo "$ACTIONS_ID_TOKEN_REQUEST_TOKEN"
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: test
`,
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml must contain npm stage publish.',
          '.github/workflows/package-release.yml must not use npm token fallback authentication.',
          '.github/workflows/package-release.yml must use npm staged publishing, not direct npm publish.',
        ]),
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
        `
name: Package Release
on:
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
  push:
    branches: [main]
permissions:
  id-token: write
jobs:
  publish:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
      - run: pnpm package-release:validate
      - run: pnpm check
      - run: pnpm build:packages
      - run: echo "$ACTIONS_ID_TOKEN_REQUEST_TOKEN"
      - run: npm stage publish
`,
      )
      await writeJson(path.join(projectRoot, 'package.json'), {
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

  it('accepts Release Please-bumped package versions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      await writeMinimalPackageReleaseProject(
        projectRoot,
        `
name: Package Release
on:
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
  push:
    branches: [main]
permissions:
  id-token: write
jobs:
  publish:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
      - run: pnpm package-release:validate
      - run: pnpm check
      - run: pnpm build:packages
      - run: echo "$ACTIONS_ID_TOKEN_REQUEST_TOKEN"
      - run: npm stage publish
`,
        '0.2.0',
      )

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual([])
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})
