import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BrowserEngineStatus } from '@shared/types/browser-engine'
import { CefComponentError, downloadCefArchive } from './cef-component-download'
import {
  CEF_COMPONENT_RECORD,
  cefComponentDirectoryName,
  cefComponentRecord,
  isCefComponentCurrent,
  missingCefComponentFile,
  pruneCefComponents,
} from './cef-component-files'
import {
  cefComponentArch,
  cefComponentTarget,
  type CefComponentManifest,
  type CefComponentTarget,
} from './cef-component-manifest'

/** The process boundaries the installer reaches; tests replace the network and `tar`. */
export interface CefComponentInstallerDependencies {
  readonly platform: NodeJS.Platform
  readonly arch: string
  /** The pinned manifest; it throws when the build carries a malformed one. */
  readonly manifest: () => CefComponentManifest
  /** `Contents/Frameworks/…/Chromium Embedded Framework` in the running app bundle. */
  readonly bundledFramework: string
  /** `<appData>/<identifier>/cef`, which holds the installed component. */
  readonly componentsDirectory: () => Promise<string>
  readonly fetch: (url: string) => Promise<Response>
  /** Extracts a `.tar.xz` into an existing directory, keeping code signatures. */
  readonly extract: (archive: string, destination: string) => Promise<void>
  readonly randomId?: () => string
}

const JSON_INDENT = 2

type Report = (status: BrowserEngineStatus) => void

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function resolveTarget(dependencies: CefComponentInstallerDependencies): CefComponentTarget {
  const arch = cefComponentArch(dependencies.arch)
  if (arch === null) {
    throw new CefComponentError(
      'install',
      `The browser engine is not available for ${dependencies.arch}.`,
    )
  }
  let manifest: CefComponentManifest
  try {
    manifest = dependencies.manifest()
  } catch (error) {
    throw new CefComponentError(
      'install',
      'This build carries an invalid browser engine manifest.',
      {
        cause: error,
      },
    )
  }
  return cefComponentTarget(manifest, arch)
}

async function extractInto(
  dependencies: CefComponentInstallerDependencies,
  archive: string,
  staging: string,
) {
  try {
    await fs.mkdir(staging)
    await dependencies.extract(archive, staging)
  } catch (error) {
    throw new CefComponentError('install', 'The browser engine archive could not be extracted.', {
      cause: error,
    })
  }
  const missing = await missingCefComponentFile(staging)
  if (missing !== null) {
    throw new CefComponentError('install', `The browser engine archive has no ${missing}.`)
  }
}

/** Moves `staging` to `root`, keeping the previous root aside until the new one is in place. */
async function replaceRoot(root: string, staging: string, old: string) {
  const hadRoot = await exists(root)
  if (hadRoot) await fs.rename(root, old)
  try {
    await fs.rename(staging, root)
  } catch (error) {
    if (hadRoot) await fs.rename(old, root).catch(() => undefined)
    throw error
  }
}

interface Install {
  readonly dependencies: CefComponentInstallerDependencies
  readonly target: CefComponentTarget
  readonly directory: string
  readonly root: string
  readonly report: Report
}

async function install({ dependencies, target, directory, root, report }: Install) {
  const id = (dependencies.randomId ?? randomUUID)()
  const archive = path.join(directory, `.download-${id}`)
  const staging = path.join(directory, `.staging-${id}`)
  const old = path.join(directory, `.old-${id}`)
  try {
    await downloadCefArchive({
      fetch: dependencies.fetch,
      asset: target.asset,
      destination: archive,
      onProgress: (progress) => report({ type: 'downloading', ...progress }),
    })
    report({ type: 'installing' })
    await extractInto(dependencies, archive, staging)
    await fs.writeFile(
      path.join(staging, CEF_COMPONENT_RECORD),
      `${JSON.stringify(cefComponentRecord(target), null, JSON_INDENT)}\n`,
    )
    await replaceRoot(root, staging, old)
  } finally {
    await Promise.all(
      [archive, staging, old].map((entry) => fs.rm(entry, { recursive: true, force: true })),
    )
  }
}

/**
 * Makes CEF loadable for the running app: nothing to do off macOS or when the bundle carries the
 * framework; otherwise the pinned component is installed under `componentsDirectory` unless it is
 * current, and every other entry there (older versions, leftover temporaries) is removed.
 */
export async function ensureCefComponent(
  dependencies: CefComponentInstallerDependencies,
  report: Report,
): Promise<void> {
  if (dependencies.platform !== 'darwin') return
  if (await exists(dependencies.bundledFramework)) return
  const target = resolveTarget(dependencies)
  const directory = await dependencies.componentsDirectory()
  const name = cefComponentDirectoryName(target)
  const root = path.join(directory, name)
  if (!(await isCefComponentCurrent(root, target))) {
    await fs.mkdir(directory, { recursive: true })
    await install({ dependencies, target, directory, root, report })
  }
  await pruneCefComponents(directory, name)
}
