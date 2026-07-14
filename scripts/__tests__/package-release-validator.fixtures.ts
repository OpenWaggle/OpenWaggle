import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

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

export const validWorkflow = readFileSync(
  path.join(process.cwd(), '.github/workflows/package-release.yml'),
  'utf8',
)

export const validCiWorkflow = readFileSync(
  path.join(process.cwd(), '.github/workflows/ci.yml'),
  'utf8',
)

async function writeFile(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents, 'utf8')
}

export async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeMinimalPackageReleaseProject(
  projectRoot: string,
  workflowText: string,
  version = '0.1.0',
  manifestState: 'released' | 'bootstrap' = 'released',
  ciWorkflowText = validCiWorkflow,
) {
  await writeJson(path.join(projectRoot, 'release-please-config.json'), {
    'release-type': 'node',
    'initial-version': '0.1.0',
    'bump-minor-pre-major': true,
    'separate-pull-requests': false,
    'include-component-in-tag': true,
    'include-v-in-tag': true,
    'always-link-local': true,
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
  await writeJson(
    path.join(projectRoot, '.release-please-manifest.json'),
    manifestState === 'bootstrap'
      ? {}
      : {
          'packages/extension-sdk': version,
          'packages/extension-react': version,
          'packages/waggle-core': version,
          'packages/pi-waggle': version,
        },
  )
  await writeJson(path.join(projectRoot, 'package.json'), {
    scripts: {
      check: 'pnpm typecheck && pnpm package:smoke',
      'package-release:publish': 'node scripts/package-release-publish.ts',
    },
  })
  await writeFile(path.join(projectRoot, '.github/workflows/package-release.yml'), workflowText)
  await writeFile(path.join(projectRoot, '.github/workflows/ci.yml'), ciWorkflowText)

  for (const [index, packageDirectory] of packageDirectories.entries()) {
    const dependencies =
      packageDirectory === 'packages/extension-react'
        ? { '@openwaggle/extension-sdk': 'workspace:^' }
        : packageDirectory === 'packages/pi-waggle'
          ? { '@openwaggle/waggle-core': 'workspace:^' }
          : undefined
    await writeJson(path.join(projectRoot, packageDirectory, 'package.json'), {
      name: packageNames[index],
      version,
      engines: {
        node: '>=22.19.0',
      },
      dependencies,
      publishConfig: {
        access: 'public',
      },
      files: ['dist', 'dist-cjs', 'CHANGELOG.md', 'README.md'],
    })
    await writeFile(path.join(projectRoot, packageDirectory, 'CHANGELOG.md'), '# Changelog\n')
  }
}
