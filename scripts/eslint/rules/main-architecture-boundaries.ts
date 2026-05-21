import path from 'node:path'
import type { Rule } from 'eslint'
import { isTestFilename, normalizedFilename, property, sourceValueOf } from '../ast-helpers'

const PI_SDK_PACKAGE = '@mariozechner/pi-coding-agent'
const PROVIDER_REGISTRY_IDENTIFIER = 'providerRegistry'
const MAIN_PROVIDERS_PREFIX = 'src/main/providers/'
const MAIN_PI_ADAPTER_PREFIX = 'src/main/adapters/pi/'
const MAIN_IPC_PREFIX = 'src/main/ipc/'
const MAIN_APPLICATION_PREFIX = 'src/main/application/'
const MAIN_STORE_PREFIX = 'src/main/store/'
const MAIN_DOMAIN_PREFIX = 'src/main/domain/'
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
  const srcIndex = normalized.lastIndexOf('/src/')

  if (srcIndex !== -1) {
    return normalized.slice(srcIndex + 1)
  }

  return normalized.startsWith('src/') ? normalized : normalized
}

function stripExtension(value: string) {
  return value.replace(/\.(ts|tsx|js|jsx)$/, '')
}

function resolveRelativeImport(importPath: string, importerPath: string) {
  if (importPath.startsWith(SHARED_ALIAS_PREFIX)) {
    return stripExtension(`src/shared/${importPath.slice(SHARED_ALIAS_LENGTH)}`)
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

function reasonForInvalidImport(importPath: string, projectPath: string) {
  const resolvedImport = resolveRelativeImport(importPath, projectPath)

  if (isPiSdkImport(importPath) && !projectPath.startsWith(MAIN_PI_ADAPTER_PREFIX)) {
    return 'Pi SDK imports are confined to src/main/adapters/pi/.'
  }

  if (projectPath.startsWith(MAIN_IPC_PREFIX) && resolvedImport?.startsWith(MAIN_STORE_PREFIX)) {
    return 'IPC handlers must use application services/ports instead of direct store imports.'
  }

  if (
    projectPath.startsWith(MAIN_APPLICATION_PREFIX) &&
    resolvedImport?.startsWith(MAIN_STORE_PREFIX)
  ) {
    return 'Application services must depend on ports, not direct store imports.'
  }

  if (projectPath.startsWith(MAIN_APPLICATION_PREFIX) && resolvedImport?.startsWith(MAIN_IPC_PREFIX)) {
    return 'Application services must not depend on IPC handlers.'
  }

  if (isDomainFile(projectPath) && isDomainInfrastructureImport(importPath)) {
    return 'Domain modules must not import infrastructure packages.'
  }

  return null
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
        if (!isProductionFile || projectPath.startsWith(MAIN_PI_ADAPTER_PREFIX)) {
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
