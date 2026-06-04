import fs from 'node:fs/promises'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { discoverExtensionPackages } from '../adapters/extensions/discovery'

const DEFAULT_EXTENSION_ID = 'sample-extension'

export async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf-8')
}

async function writeJson(filePath: string, value: unknown) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export function runtimeModuleUrl(input: {
  readonly packagePath: string
  readonly contentHash: string
  readonly relativePath: string
  readonly projectPaths?: readonly string[]
}) {
  const encodedPackagePath = encodeURIComponent(input.packagePath)
  const encodedContentHash = encodeURIComponent(input.contentHash)
  const encodedProjectPaths = encodeURIComponent(JSON.stringify(input.projectPaths ?? []))
  const encodedRelativePath = input.relativePath.split('/').map(encodeURIComponent).join('/')
  return `openwaggle-extension://runtime/module/${encodedPackagePath}/${encodedContentHash}/${encodedProjectPaths}/${encodedRelativePath}`
}

export async function writeExtensionPackage(input: {
  readonly projectPath: string
  readonly globalRootPath?: string
  readonly scope: 'project' | 'global'
  readonly builtArtifacts?: readonly string[]
  readonly tmpRoot: string
}) {
  const rootPath =
    input.scope === 'project'
      ? path.join(input.projectPath, '.openwaggle', 'extensions')
      : (input.globalRootPath ?? path.join(input.tmpRoot, 'user-data', 'extensions'))
  const packagePath = path.join(rootPath, DEFAULT_EXTENSION_ID)
  const builtArtifacts = input.builtArtifacts ?? ['dist/route.js']
  await writeJson(path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE), {
    manifestVersion: 1,
    id: DEFAULT_EXTENSION_ID,
    name: 'Sample Extension',
    version: '1.0.0',
    sdk: { openwaggle: '>=0.1.0 <0.2.0' },
    sourceFiles: ['src/index.ts'],
    builtArtifacts,
    contributions: {
      routes: [
        {
          id: 'sample.route',
          title: 'Sample Route',
          runtime: 'federated-module',
          execution: 'host-renderer',
          entry: 'dist/route.js',
        },
      ],
    },
  })
  await writeText(path.join(packagePath, 'src', 'index.ts'), 'export const source = true\n')
  for (const artifactPath of builtArtifacts) {
    await writeText(path.join(packagePath, artifactPath), `export const file = '${artifactPath}'\n`)
  }

  const packages = await discoverExtensionPackages({
    projectPath: input.projectPath,
    globalRootPath: input.globalRootPath,
    hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
  })
  const extensionPackage = packages.find(
    (candidate) => candidate.id === DEFAULT_EXTENSION_ID && candidate.packagePath === packagePath,
  )
  if (!extensionPackage?.contentHash) {
    throw new Error('Expected extension package content hash.')
  }

  return {
    packagePath,
    contentHash: extensionPackage.contentHash,
  }
}
