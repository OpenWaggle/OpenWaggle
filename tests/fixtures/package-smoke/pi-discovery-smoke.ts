import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function piExtensionPaths(manifest: unknown) {
  if (typeof manifest !== 'object' || manifest === null || !('pi' in manifest)) {
    throw new Error('@openwaggle/pi-waggle must expose Pi extension discovery metadata.')
  }

  const pi = manifest.pi
  if (typeof pi !== 'object' || pi === null || !('extensions' in pi) || !Array.isArray(pi.extensions)) {
    throw new Error('@openwaggle/pi-waggle must expose Pi extension discovery metadata.')
  }

  if (pi.extensions.length === 0 || pi.extensions.some((extensionPath) => typeof extensionPath !== 'string')) {
    throw new Error('@openwaggle/pi-waggle Pi extension metadata must contain string paths.')
  }

  return pi.extensions
}

const packageEntry = await import.meta.resolve('@openwaggle/pi-waggle')
const packageRoot = path.dirname(path.dirname(fileURLToPath(packageEntry)))
const manifestPath = path.join(packageRoot, 'package.json')
const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'))

for (const extensionPath of piExtensionPaths(manifest)) {
  await import(pathToFileURL(path.join(packageRoot, extensionPath)).href)
}

console.log('pi extension discovery smoke passed')
