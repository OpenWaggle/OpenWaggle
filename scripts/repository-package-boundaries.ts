import { builtinModules } from 'node:module'
import path from 'node:path'

export interface RepositoryViolation {
  readonly detail?: string
  readonly file: string
  readonly message: string
}

interface PackageBoundaryRule {
  readonly allowNodeBuiltins: boolean
  readonly allowedExternalPrefixes: readonly string[]
  readonly allowedExternalSpecifiers: readonly string[]
  readonly directory: string
  readonly forbiddenExternalPrefixes: readonly string[]
  readonly forbiddenExternalSpecifiers: readonly string[]
  readonly name: string
}

const IMPORT_SPECIFIER_CAPTURE_INDEX = 1
const EXPORT_SPECIFIER_CAPTURE_INDEX = 2

const importSpecifierPattern =
  /(?:^|\n)\s*import\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"]+)['"]|(?:^|\n)\s*export\s+[^'"\n]+\s+from\s+['"]([^'"]+)['"]/g

const builtinSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
])

const openWaggleAppImportPrefixes = [
  '@/',
  '@shared/',
  'src/',
  'electron/',
  'electron-vite',
  'electron-builder',
] as const

const packageBoundaryRules: readonly PackageBoundaryRule[] = [
  {
    name: '@openwaggle/extension-sdk',
    directory: 'packages/extension-sdk',
    allowNodeBuiltins: false,
    allowedExternalSpecifiers: [],
    allowedExternalPrefixes: [],
    forbiddenExternalSpecifiers: ['electron'],
    forbiddenExternalPrefixes: [
      '@/',
      '@shared/',
      '@earendil-works/',
      '@openwaggle/pi-waggle',
      '@openwaggle/waggle-core',
      'src/',
    ],
  },
  {
    name: '@openwaggle/extension-react',
    directory: 'packages/extension-react',
    allowNodeBuiltins: false,
    allowedExternalSpecifiers: ['react', 'react/jsx-runtime', '@openwaggle/extension-sdk'],
    allowedExternalPrefixes: ['@openwaggle/extension-sdk/'],
    forbiddenExternalSpecifiers: ['electron'],
    forbiddenExternalPrefixes: [
      '@/',
      '@shared/',
      '@earendil-works/',
      '@openwaggle/pi-waggle',
      '@openwaggle/waggle-core',
      'src/',
    ],
  },
  {
    name: '@openwaggle/waggle-core',
    directory: 'packages/waggle-core',
    allowNodeBuiltins: false,
    allowedExternalSpecifiers: [],
    allowedExternalPrefixes: [],
    forbiddenExternalSpecifiers: ['electron'],
    forbiddenExternalPrefixes: [
      '@/',
      '@shared/',
      '@earendil-works/',
      '@openwaggle/pi-waggle',
      '@openwaggle/extension-sdk',
      '@openwaggle/extension-react',
      'src/',
    ],
  },
  {
    name: '@openwaggle/pi-waggle',
    directory: 'packages/pi-waggle',
    allowNodeBuiltins: true,
    allowedExternalSpecifiers: [
      '@openwaggle/waggle-core',
      '@earendil-works/pi-coding-agent',
      '@earendil-works/pi-tui',
    ],
    allowedExternalPrefixes: ['@openwaggle/waggle-core/'],
    forbiddenExternalSpecifiers: ['electron'],
    forbiddenExternalPrefixes: [
      '@/',
      '@shared/',
      '@openwaggle/extension-sdk',
      '@openwaggle/extension-react',
      'src/',
    ],
  },
]

export const packageBoundarySourceGlobs = ['packages/*/src/**/*.{ts,tsx}'] as const

function normalizePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function normalizedWithTrailingSlash(filePath: string) {
  return normalizePath(filePath).replace(/\/+$/, '') + '/'
}

function collectImportSpecifiers(contents: string) {
  const specifiers: string[] = []
  let match = importSpecifierPattern.exec(contents)

  while (match !== null) {
    const specifier = match[IMPORT_SPECIFIER_CAPTURE_INDEX] ?? match[EXPORT_SPECIFIER_CAPTURE_INDEX]
    if (specifier !== undefined) {
      specifiers.push(specifier)
    }
    match = importSpecifierPattern.exec(contents)
  }

  return specifiers
}

function packageRuleForFile(file: string) {
  return packageBoundaryRules.find((rule) => file.startsWith(`${rule.directory}/`))
}

function isAllowedExternal(rule: PackageBoundaryRule, specifier: string) {
  return (
    rule.allowedExternalSpecifiers.some((allowed) => allowed === specifier) ||
    rule.allowedExternalPrefixes.some((prefix) => specifier.startsWith(prefix))
  )
}

function isForbiddenExternal(rule: PackageBoundaryRule, specifier: string) {
  return (
    rule.forbiddenExternalSpecifiers.some((forbidden) => forbidden === specifier) ||
    rule.forbiddenExternalPrefixes.some((prefix) => specifier.startsWith(prefix))
  )
}

function resolveRelativeImport(file: string, specifier: string) {
  return normalizePath(path.normalize(path.join(path.dirname(file), specifier)))
}

function relativeBoundaryViolation(input: {
  readonly file: string
  readonly packageDirectory: string
  readonly rule: PackageBoundaryRule
  readonly specifier: string
}) {
  const resolved = resolveRelativeImport(input.file, input.specifier)
  if (normalizedWithTrailingSlash(resolved).startsWith(input.packageDirectory)) {
    return null
  }

  return {
    detail: input.specifier,
    file: input.file,
    message: `${input.rule.name} cannot import files outside its package boundary.`,
  }
}

function externalBoundaryViolation(input: {
  readonly file: string
  readonly rule: PackageBoundaryRule
  readonly specifier: string
}): RepositoryViolation | null {
  if (builtinSpecifiers.has(input.specifier) && !input.rule.allowNodeBuiltins) {
    return {
      detail: input.specifier,
      file: input.file,
      message: `${input.rule.name} must stay browser/runtime neutral and cannot import Node built-ins.`,
    }
  }

  if (isForbiddenExternal(input.rule, input.specifier)) {
    return {
      detail: input.specifier,
      file: input.file,
      message: `${input.rule.name} cannot import forbidden package or OpenWaggle app internals.`,
    }
  }

  if (input.specifier.startsWith('@openwaggle/') && !isAllowedExternal(input.rule, input.specifier)) {
    return {
      detail: input.specifier,
      file: input.file,
      message: `${input.rule.name} cannot import another OpenWaggle package without an explicit boundary allowance.`,
    }
  }

  if (
    openWaggleAppImportPrefixes.some((prefix) => input.specifier.startsWith(prefix)) &&
    !isAllowedExternal(input.rule, input.specifier)
  ) {
    return {
      detail: input.specifier,
      file: input.file,
      message: `${input.rule.name} cannot import OpenWaggle app internals.`,
    }
  }

  return null
}

export function collectPackageBoundaryViolations(file: string, contents: string) {
  const rule = packageRuleForFile(file)
  if (rule === undefined) {
    return []
  }

  const violations: RepositoryViolation[] = []
  const packageDirectory = normalizedWithTrailingSlash(rule.directory)

  for (const specifier of collectImportSpecifiers(contents)) {
    const violation = specifier.startsWith('.')
      ? relativeBoundaryViolation({ file, packageDirectory, rule, specifier })
      : externalBoundaryViolation({ file, rule, specifier })

    if (violation !== null) {
      violations.push(violation)
    }
  }

  return violations
}
