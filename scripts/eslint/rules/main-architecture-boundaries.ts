import path from 'node:path'
import type { Rule } from 'eslint'
import { isTestFilename, normalizedFilename, property, sourceValueOf } from '../ast-helpers'

const PI_SDK_PACKAGE = '@mariozechner/pi-coding-agent'
const PROVIDER_REGISTRY_IDENTIFIER = 'providerRegistry'
const MAIN_PROVIDERS_PREFIX = 'src/main/providers/'
const MAIN_PI_ADAPTER_PREFIX = 'src/main/adapters/pi/'
const PACKAGE_PI_PREFIX = 'packages/pi-'
const PACKAGE_PI_WAGGLE_PREFIX = 'packages/pi-waggle/'
const PACKAGE_WAGGLE_CORE_PREFIX = 'packages/waggle-core/'
const PI_WAGGLE_IMPORT_PREFIX = '@openwaggle/pi-waggle'
const RENDERER_ALIAS_PREFIX = '@/'
const MAIN_IPC_PREFIX = 'src/main/ipc/'
const MAIN_APPLICATION_PREFIX = 'src/main/application/'
const MAIN_STORE_PREFIX = 'src/main/store/'
const MAIN_DOMAIN_PREFIX = 'src/main/domain/'
const RENDERER_PREFIX = 'src/renderer/'
const SHARED_PREFIX = 'src/shared/'
const SHARED_DOMAIN_PREFIX = 'src/shared/domain/'
const SHARED_ALIAS_PREFIX = '@shared/'
const SHARED_ALIAS_LENGTH = SHARED_ALIAS_PREFIX.length

const DOMAIN_FORBIDDEN_IMPORTS = new Set(['electron', 'node:child_process'])
const DOMAIN_FORBIDDEN_IMPORT_PREFIXES = ['node:fs', '@effect/sql']
const FILE_START_LOCATION = {
  line: 1,
  column: 0,
}

function toProjectPath(filename: string) {
  const normalized = normalizedFilename(filename)
  if (normalized.startsWith('packages/')) {
    return normalized
  }

  const packageIndex = normalized.lastIndexOf('/packages/')
  if (packageIndex !== -1) {
    return normalized.slice(packageIndex + 1)
  }

  if (normalized.startsWith('src/')) {
    return normalized
  }

  const srcIndex = normalized.indexOf('/src/')
  if (srcIndex !== -1) {
    return normalized.slice(srcIndex + 1)
  }

  return normalized
}

function stripExtension(value: string) {
  return value.replace(/\.(ts|tsx|js|jsx)$/, '')
}

function resolveRelativeImport(importPath: string, importerPath: string) {
  if (importPath.startsWith(SHARED_ALIAS_PREFIX)) {
    return stripExtension(`src/shared/${importPath.slice(SHARED_ALIAS_LENGTH)}`)
  }

  if (importPath.startsWith(RENDERER_ALIAS_PREFIX)) {
    return stripExtension(`src/renderer/src/${importPath.slice(RENDERER_ALIAS_PREFIX.length)}`)
  }

  if (!importPath.startsWith('.')) {
    return null
  }

  return stripExtension(path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), importPath)))
}

function isDomainFile(projectPath: string) {
  return projectPath.startsWith(MAIN_DOMAIN_PREFIX) || projectPath.startsWith(SHARED_DOMAIN_PREFIX)
}

function isDomainInfrastructureImport(importPath: string) {
  return (
    DOMAIN_FORBIDDEN_IMPORTS.has(importPath) ||
    DOMAIN_FORBIDDEN_IMPORT_PREFIXES.some((prefix) => importPath.startsWith(prefix))
  )
}

function isPiSdkImport(importPath: string) {
  return importPath === PI_SDK_PACKAGE || importPath.startsWith(`${PI_SDK_PACKAGE}/`)
}

function isDedicatedPiPackageFile(projectPath: string) {
  return projectPath.startsWith(PACKAGE_PI_PREFIX)
}

function isMainProcessFile(projectPath: string) {
  return projectPath.startsWith('src/main/')
}

function isOpenWaggleAppImport(importPath: string, resolvedImport: string | null) {
  return (
    importPath.startsWith(SHARED_ALIAS_PREFIX) ||
    importPath.startsWith(RENDERER_ALIAS_PREFIX) ||
    importPath.startsWith('src/') ||
    resolvedImport?.startsWith('src/') === true
  )
}

function waggleCoreBoundaryReason(importPath: string, resolvedImport: string | null) {
  if (isOpenWaggleAppImport(importPath, resolvedImport)) {
    return 'packages/waggle-core must stay portable and must not import OpenWaggle app modules.'
  }

  if (
    importPath === PI_WAGGLE_IMPORT_PREFIX ||
    importPath.startsWith(`${PI_WAGGLE_IMPORT_PREFIX}/`) ||
    resolvedImport?.startsWith(PACKAGE_PI_WAGGLE_PREFIX)
  ) {
    return 'packages/waggle-core must stay Pi-adapter free and must not import packages/pi-waggle.'
  }

  return importPath === 'electron' || isPiSdkImport(importPath)
    ? 'packages/waggle-core must stay portable and may not import Electron or Pi SDK modules.'
    : null
}

function piPackageBoundaryReason(importPath: string, projectPath: string, resolvedImport: string | null) {
  if (projectPath.startsWith(PACKAGE_WAGGLE_CORE_PREFIX)) {
    return waggleCoreBoundaryReason(importPath, resolvedImport)
  }

  if (projectPath.startsWith(PACKAGE_PI_WAGGLE_PREFIX) && isOpenWaggleAppImport(importPath, resolvedImport)) {
    return 'packages/pi-waggle must stay reusable and must not import OpenWaggle app modules.'
  }

  return null
}

function piWaggleRendererBoundaryReason(importPath: string, projectPath: string) {
  return (projectPath.startsWith(RENDERER_PREFIX) || projectPath.startsWith(SHARED_PREFIX)) &&
    (importPath === PI_WAGGLE_IMPORT_PREFIX || importPath.startsWith(`${PI_WAGGLE_IMPORT_PREFIX}/`))
    ? 'OpenWaggle renderer/shared code may not import pi-waggle adapter package surfaces; use @openwaggle/waggle-core or shared DTOs.'
    : null
}

function piWaggleDesktopRootImportReason(importPath: string, projectPath: string) {
  return importPath === PI_WAGGLE_IMPORT_PREFIX && projectPath.startsWith(MAIN_PI_ADAPTER_PREFIX)
    ? 'Desktop Pi adapters must import narrow @openwaggle/pi-waggle subpaths instead of the UI-heavy package root.'
    : null
}

function piSdkBoundaryReason(importPath: string, projectPath: string) {
  return isPiSdkImport(importPath) &&
    !projectPath.startsWith(MAIN_PI_ADAPTER_PREFIX) &&
    !isDedicatedPiPackageFile(projectPath)
    ? 'Pi SDK imports are confined to src/main/adapters/pi/ for the desktop app; dedicated packages under packages/pi-* may import them.'
    : null
}

function mainLayerBoundaryReason(projectPath: string, resolvedImport: string | null) {
  if (projectPath.startsWith(MAIN_IPC_PREFIX) && resolvedImport?.startsWith(MAIN_STORE_PREFIX)) {
    return 'IPC handlers must use application services/ports instead of direct store imports.'
  }

  if (
    projectPath.startsWith(MAIN_APPLICATION_PREFIX) &&
    resolvedImport?.startsWith(MAIN_STORE_PREFIX)
  ) {
    return 'Application services must depend on ports, not direct store imports.'
  }

  return projectPath.startsWith(MAIN_APPLICATION_PREFIX) && resolvedImport?.startsWith(MAIN_IPC_PREFIX)
    ? 'Application services must not depend on IPC handlers.'
    : null
}

function reasonForInvalidImport(importPath: string, projectPath: string) {
  const resolvedImport = resolveRelativeImport(importPath, projectPath)

  return (
    piPackageBoundaryReason(importPath, projectPath, resolvedImport) ??
    piWaggleRendererBoundaryReason(importPath, projectPath) ??
    piWaggleDesktopRootImportReason(importPath, projectPath) ??
    piSdkBoundaryReason(importPath, projectPath) ??
    mainLayerBoundaryReason(projectPath, resolvedImport) ??
    (isDomainFile(projectPath) && isDomainInfrastructureImport(importPath)
      ? 'Domain modules must not import infrastructure packages.'
      : null)
  )
}

function reportViolation(context: Rule.RuleContext, node: Rule.Node, reason: string) {
  context.report({
    node,
    messageId: 'invalidBoundary',
    data: { reason },
  })
}

export const mainArchitectureBoundariesRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    messages: {
      invalidBoundary: 'Invalid hexagonal architecture boundary: {{reason}}',
    },
  },
  create(context) {
    const projectPath = toProjectPath(context.filename)
    const isProductionFile = !isTestFilename(projectPath)

    function checkImport(node: Rule.Node) {
      const importPath = sourceValueOf(node)
      if (!importPath) {
        return
      }

      const reason = reasonForInvalidImport(importPath, projectPath)
      if (reason) {
        reportViolation(context, node, reason)
      }
    }

    return {
      ExportAllDeclaration: checkImport,
      ExportNamedDeclaration: checkImport,
      Identifier(node: Rule.Node) {
        if (
          !isProductionFile ||
          !isMainProcessFile(projectPath) ||
          projectPath.startsWith(MAIN_PI_ADAPTER_PREFIX)
        ) {
          return
        }

        if (property(node, 'name') === PROVIDER_REGISTRY_IDENTIFIER) {
          reportViolation(
            context,
            node,
            'providerRegistry references are not allowed in production main-process source.',
          )
        }
      },
      ImportDeclaration: checkImport,
      Program() {
        if (projectPath.startsWith(MAIN_PROVIDERS_PREFIX)) {
          context.report({
            loc: FILE_START_LOCATION,
            messageId: 'invalidBoundary',
            data: {
              reason:
                'src/main/providers is not a valid runtime directory; provider metadata comes from Pi adapter ports.',
            },
          })
        }
      },
    }
  },
}
