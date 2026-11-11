import fs from 'node:fs/promises'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionBrokerTransport } from '@shared/extension-sdk-core'
import { discoverExtensionPackages } from '../../adapters/extensions/discovery'
import { activateTrustedMainExtension } from '../trusted-main-runtime'
import type { DiscoveredExtensionPackage } from '../types'

const unusedTransport: ExtensionBrokerTransport = async () => {
  throw new Error('Unexpected broker invocation.')
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf-8')
}

function packageContentHash(extensionPackage: DiscoveredExtensionPackage) {
  if (extensionPackage.contentHash === null) {
    throw new Error('Expected extension package content hash.')
  }
  return extensionPackage.contentHash
}

/** Writes a project with one trusted main extension whose entry is `mainModuleSource`. */
export async function writeTrustedMainPackage(input: {
  readonly root: string
  readonly mainModuleSource: string
  readonly networkOrigins?: readonly string[]
}) {
  const projectPath = path.join(input.root, 'project')
  const packagePath = path.join(projectPath, '.openwaggle', 'extensions', 'sample-extension')
  const trustedMainPath = 'dist/main.mjs'
  const manifest = {
    manifestVersion: 1,
    id: 'sample-extension',
    name: 'Sample Extension',
    version: '1.0.0',
    sdk: { openwaggle: '>=0.1.0 <0.2.0' },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: [trustedMainPath],
    trusted: { main: trustedMainPath },
    ...(input.networkOrigins !== undefined ? { network: { origins: input.networkOrigins } } : {}),
  }

  await writeText(
    path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await writeText(path.join(packagePath, 'src', 'index.ts'), 'export const source = true\n')
  await writeText(path.join(packagePath, trustedMainPath), input.mainModuleSource)

  const packages = await discoverExtensionPackages({
    projectPath,
    hostSdkVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
  })
  const extensionPackage = packages[0]
  if (!extensionPackage) {
    throw new Error('Expected discovered extension package.')
  }
  return extensionPackage
}

/** Activates a trusted main extension whose broker must never be called. */
export function activateTrustedMainPackage(extensionPackage: DiscoveredExtensionPackage) {
  return activateTrustedMainExtension({
    extensionPackage,
    contentHash: packageContentHash(extensionPackage),
    transport: unusedTransport,
  })
}
