import type { Rule } from 'eslint'

interface UnknownObject {
  readonly [key: string]: unknown
}

interface SourceRange {
  readonly start: number
  readonly end: number
}

export interface NodeWithReturnType {
  readonly returnType: Rule.Node
  readonly body: unknown
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null
}

export function property(value: unknown, key: string) {
  if (!isObject(value)) {
    return undefined
  }

  return value[key]
}

export function nodeType(value: unknown) {
  const type = property(value, 'type')
  return typeof type === 'string' ? type : null
}

export function hasNodeType(value: unknown, type: string) {
  return nodeType(value) === type
}

export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

export function isLintNode(value: unknown): value is Rule.Node {
  return nodeType(value) !== null
}

export function rangeFrom(value: unknown): SourceRange | null {
  const range = property(value, 'range')
  if (!isUnknownArray(range)) {
    return null
  }

  const start = range[0]
  const end = range[1]
  if (typeof start !== 'number' || typeof end !== 'number') {
    return null
  }

  return { start, end }
}

export function parentOf(value: unknown) {
  return property(value, 'parent')
}

export function sourceValueOf(node: Rule.Node) {
  const sourceValue = property(property(node, 'source'), 'value')
  return typeof sourceValue === 'string' ? sourceValue : null
}

function stringLiteralValue(value: unknown) {
  const literal = property(value, 'value')
  return typeof literal === 'string' ? literal : null
}

/**
 * The module a node names with a string literal: an import or export declaration, a dynamic
 * `import()`, an `import()` type (Babel puts its specifier in `source`, typescript-estree in
 * `argument.literal`), or `require()`. A computed specifier names no module that lint can see.
 */
export function moduleSpecifierOf(node: Rule.Node) {
  const type = nodeType(node)
  if (type === 'TSImportType') {
    const argument = property(node, 'argument')
    return sourceValueOf(node) ?? stringLiteralValue(property(argument, 'literal') ?? argument)
  }
  if (type === 'CallExpression') {
    const callee = property(node, 'callee')
    const args = property(node, 'arguments')
    const isRequire = hasNodeType(callee, 'Identifier') && property(callee, 'name') === 'require'
    return isRequire && isUnknownArray(args) && args.length === 1 ? stringLiteralValue(args[0]) : null
  }
  return sourceValueOf(node)
}

export function jsxIdentifierName(node: Rule.Node) {
  const name = property(property(node, 'name'), 'name')
  return typeof name === 'string' ? name : null
}

export function normalizedFilename(filename: string) {
  return filename.replaceAll('\\', '/')
}

export function isTestFilename(filename: string) {
  const normalized = normalizedFilename(filename)

  return (
    normalized.includes('/__tests__/') ||
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)
  )
}
