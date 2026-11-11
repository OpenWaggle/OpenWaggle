import path from 'node:path'
import type { Context, ESTree, Rule } from '@oxlint/plugins'
import { moduleSpecifierOf, normalizedFilename } from '../ast-helpers.ts'

/**
 * The desktop shell boundary (ADR 0064): OpenWaggle moves from Electron to Electrobun behind the
 * desktop shell ports in `src/main/ports/desktop-shell/`. Only each shell's adapters and its
 * preload transport may reach the shell, so the shell switch replaces those modules and nothing
 * else. Every reference counts, type-only imports, `import()` types, `require()` and the ambient
 * `Electron.*` namespace included.
 */
interface ShellPackages {
  readonly packages: readonly string[]
  readonly owners: readonly string[]
  readonly reason: string
}

const SHELLS: readonly ShellPackages[] = [
  {
    packages: ['electron', 'electron-updater', '@electron-toolkit/'],
    owners: ['src/main/adapters/electron/'],
    reason: 'src/main/adapters/electron/',
  },
  {
    // Electrobun 2.x: `electrobun/main` in the Bun main process, `electrobun/view` in webviews.
    packages: ['electrobun'],
    owners: ['src/main/adapters/electrobun/', 'src/preload/transport.ts', 'src/preload/__tests__/'],
    reason: 'src/main/adapters/electrobun/ or src/preload/transport.ts',
  },
]

/**
 * The crash-reporting vendor SDKs (ADR 0045): the main reporters are shell adapters, and the
 * preload and renderer bridges hand reports to them.
 */
const SENTRY_PACKAGES: readonly ShellPackages[] = [
  {
    packages: ['@sentry/electron'],
    owners: ['src/main/adapters/electron/'],
    reason: 'the crash-reporting adapters',
  },
  {
    packages: ['@sentry/bun', '@sentry/browser'],
    owners: [
      'src/main/adapters/electrobun/',
      'src/preload/error-reporting-bridge.ts',
      'src/preload/__tests__/',
      'src/renderer/src/shared/lib/sentry-renderer.ts',
      'src/renderer/src/shared/lib/__tests__/sentry-renderer.unit.test.ts',
    ],
    reason: 'the crash-reporting adapters',
  },
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

function owningGroup(importPath: string, groups: readonly ShellPackages[]) {
  return groups.find((group) =>
    group.packages.some((packageName) => namesPackage(importPath, packageName)),
  )
}

/** Why `importPath` may not be imported from `projectPath`, or null when it may. */
export function desktopShellBoundaryReason(importPath: string, projectPath: string) {
  if (!projectPath.startsWith('src/')) return null
  const sentry = owningGroup(importPath, SENTRY_PACKAGES)
  if (sentry) {
    return isOwnedBy(projectPath, sentry.owners)
      ? null
      : `${importPath} belongs to ${sentry.reason}; report errors through the ErrorReporter port.`
  }
  const shell = owningGroup(importPath, SHELLS)
  if (!shell || isOwnedBy(projectPath, shell.owners)) return null
  return `${importPath} may only be imported in ${shell.reason}; use a desktop shell port (src/main/ports/desktop-shell/) or its binding in src/main/desktop-shell/.`
}

function report(context: Context, node: ESTree.Node, reason: string) {
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

    function checkReference(node: ESTree.Node) {
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
      TSQualifiedName(node) {
        const { left } = node
        if (left.type !== 'Identifier' || left.name !== ELECTRON_NAMESPACE) {
          return
        }
        const reason = desktopShellBoundaryReason('electron', projectPath)
        if (reason) report(context, node, reason)
      },
    }
  },
}
