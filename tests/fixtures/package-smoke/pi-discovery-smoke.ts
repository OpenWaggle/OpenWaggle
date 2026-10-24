import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'

const EXPECTED_COMMANDS = ['waggle', 'standard']
const EXPECTED_RENDERER = 'pi-waggle.turn'

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
const declaredPaths = piExtensionPaths(manifest)

for (const extensionPath of declaredPaths) {
  await import(pathToFileURL(path.join(packageRoot, extensionPath)).href)
}

/**
 * Load the installed package the way `pi install` does: as a package source, through Pi's own
 * resource loader, which reads the manifest, loads each declared entry, and warns about host
 * packages a Pi package installs itself.
 */
const agentDir = await fs.mkdtemp(path.join(tmpdir(), 'pi-waggle-discovery-'))
try {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir,
    settingsManager: SettingsManager.inMemory({ packages: [packageRoot] }),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  await loader.reload()
  const result = loader.getExtensions()
  if (result.errors.length > 0) {
    throw new Error(`Pi could not load @openwaggle/pi-waggle: ${JSON.stringify(result.errors)}`)
  }
  if ((result.warnings ?? []).length > 0) {
    throw new Error(`Pi warned about @openwaggle/pi-waggle: ${JSON.stringify(result.warnings)}`)
  }

  const loadedPaths = result.extensions.map((extension) => extension.path)
  for (const extensionPath of declaredPaths) {
    const resolved = await fs.realpath(path.join(packageRoot, extensionPath))
    const loaded = await Promise.all(loadedPaths.map((loadedPath) => fs.realpath(loadedPath)))
    if (!loaded.includes(resolved)) {
      throw new Error(`Pi did not load the declared extension ${extensionPath}; loaded: ${loadedPaths.join(', ')}`)
    }
  }
  const commands = result.extensions.flatMap((extension) => [...extension.commands.keys()])
  for (const command of EXPECTED_COMMANDS) {
    if (!commands.includes(command)) {
      throw new Error(`@openwaggle/pi-waggle did not register /${command}; commands: ${commands.join(', ')}`)
    }
  }
  if (!result.extensions.some((extension) => extension.messageRenderers.has(EXPECTED_RENDERER))) {
    throw new Error(`@openwaggle/pi-waggle did not register its ${EXPECTED_RENDERER} renderer.`)
  }
} finally {
  await fs.rm(agentDir, { recursive: true, force: true })
}

console.log('pi extension discovery smoke passed')
