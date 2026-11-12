import type { ESTree } from '@oxlint/plugins'

export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

/** The string a declaration's `source` names; `import()` and others name no literal here. */
export function sourceValueOf(node: ESTree.Node) {
  const source = 'source' in node ? node.source : null
  return source?.type === 'Literal' && typeof source.value === 'string' ? source.value : null
}

/** A string literal's value, or the text of a template literal with no `${}` expressions. */
function stringLiteralValue(node: ESTree.Node | null | undefined) {
  if (node?.type === 'TemplateLiteral') {
    if (node.expressions.length > 0 || node.quasis.length !== 1) return null
    return node.quasis[0]?.value.cooked ?? null
  }
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null
}

/**
 * The module a node names with a string literal or a template literal with no expressions: an
 * import or export declaration, a dynamic `import()`, an `import()` type, or `require()`. A
 * computed specifier names no module that lint can see.
 */
export function moduleSpecifierOf(node: ESTree.Node) {
  if (node.type === 'CallExpression') {
    const { callee, arguments: args } = node
    const isRequire = callee.type === 'Identifier' && callee.name === 'require'
    return isRequire && args.length === 1 ? stringLiteralValue(args[0]) : null
  }
  // Declarations always name a string literal; a dynamic import() may name a template literal.
  return stringLiteralValue('source' in node ? node.source : null)
}

/** The name of a JSX element named by a plain identifier (`<Button>`, not `<a.b>` or `<a:b>`). */
export function jsxIdentifierName(node: ESTree.JSXOpeningElement) {
  return node.name.type === 'JSXIdentifier' ? node.name.name : null
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
