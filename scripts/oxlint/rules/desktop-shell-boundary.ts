import path from 'node:path'
import type { Context, Node, Rule } from '@oxlint/plugins'
import { hasNodeType, moduleSpecifierOf, normalizedFilename, property } from '../ast-helpers.ts'

/**
 * The desktop shell boundary (ADR 0064): main code reaches Electron through the desktop shell
 * ports in `src/main/ports/desktop-shell/`. Only the Electron adapters and the preload transport
 * may reach Electron, so a shell switch would replace those modules and nothing else. Every
 * reference counts, type-only imports, `import()` types, `require()` and the ambient
 * `Electron.*` namespace included.
 */
const ELECTRON_SHELL_PACKAGES = ['electron', 'electron-updater', '@electron-toolkit/']

/** Modules that may import the Electron shell packages above, and their own tests. */
const ELECTRON_SHELL_OWNERS = [
  'src/main/adapters/electron/',
  'src/preload/electron-transport.ts',
  // The preload tests drive `window.api` through the transport against a stubbed `ipcRenderer`.
  'src/preload/__tests__/',
]

/**
 * Sentry's Electron SDK is the crash-reporting vendor (ADR 0045): the main reporter is an
 * Electron adapter, and the preload and renderer bridges hand reports to it over Electron IPC.
 */
const SENTRY_ELECTRON_PACKAGE = '@sentry/electron'
const SENTRY_ELECTRON_OWNERS = [
  'src/main/adapters/electron/',
  'src/preload/error-reporting-bridge.ts',
  'src/preload/__tests__/',
  'src/renderer/src/shared/lib/sentry-renderer.ts',
  'src/renderer/src/shared/lib/__tests__/sentry-renderer.unit.test.ts',
]

const ELECTRON_NAMESPACE = 'Electron'

/** The repository-relative path; lint runs from the repository root. */
function toProjectPath(filename: string) {
  const relative = path.isAbsolute(filename) ? path.relative(process.cwd(), filename) : filename
  const normalized = normalizedFilename(relative)
  if (normalized.startsWith('src/')) return normalized
  const srcIndex = normalized.indexOf('/src/')
  return srcIndex === -1 ? normalized : normalized.slice(srcIndex + 1)
}

function namesPackage(importPath: string, packageName: string) {
  if (packageName.endsWith('/')) return importPath.startsWith(packageName)
  return importPath === packageName || importPath.startsWith(`${packageName}/`)
}

function isOwnedBy(projectPath: string, owners: readonly string[]) {
  return owners.some((owner) =>
    owner.endsWith('/') ? projectPath.startsWith(owner) : projectPath === owner,
  )
}

/** Why `importPath` may not be imported from `projectPath`, or null when it may. */
export function desktopShellBoundaryReason(importPath: string, projectPath: string) {
  if (!projectPath.startsWith('src/')) return null
  if (namesPackage(importPath, SENTRY_ELECTRON_PACKAGE)) {
    return isOwnedBy(projectPath, SENTRY_ELECTRON_OWNERS)
      ? null
      : `${importPath} belongs to the crash-reporting adapters; report errors through the ErrorReporter port.`
  }
  if (!ELECTRON_SHELL_PACKAGES.some((packageName) => namesPackage(importPath, packageName))) {
    return null
  }
  return isOwnedBy(projectPath, ELECTRON_SHELL_OWNERS)
    ? null
    : `${importPath} may only be imported in src/main/adapters/electron/ or src/preload/electron-transport.ts; use a desktop shell port (src/main/ports/desktop-shell/) or its binding in src/main/desktop-shell/.`
}

function report(context: Context, node: Node, reason: string) {
  context.report({ node, messageId: 'electronOutsideShellAdapter', data: { reason } })
}

export const desktopShellBoundaryRule: Rule = {
  meta: {
    type: 'problem',
    messages: {
      electronOutsideShellAdapter: 'Electron outside the desktop shell adapters: {{reason}}',
    },
  },
  create(context) {
    const projectPath = toProjectPath(context.filename)

    function checkReference(node: Node) {
      const importPath = moduleSpecifierOf(node)
      const reason = importPath ? desktopShellBoundaryReason(importPath, projectPath) : null
      if (reason) report(context, node, reason)
    }

    return {
      CallExpression: checkReference,
      ExportAllDeclaration: checkReference,
      ExportNamedDeclaration: checkReference,
      ImportDeclaration: checkReference,
      ImportExpression: checkReference,
      TSImportType: checkReference,
      TSQualifiedName(node: Node) {
        const left = property(node, 'left')
        if (!hasNodeType(left, 'Identifier') || property(left, 'name') !== ELECTRON_NAMESPACE) {
          return
        }
        const reason = desktopShellBoundaryReason('electron', projectPath)
        if (reason) report(context, node, reason)
      },
    }
  },
}
