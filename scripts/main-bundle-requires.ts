import { builtinModules } from 'node:module'
import { parseSync } from 'vite'

/**
 * Packages the Electron main bundle may `require()` at its top level, before any OpenWaggle code
 * runs. Everything else must load where it is first used: the GUI, the Session Host and every CLI
 * call evaluate this file's top level (startup-main.md, A-F4). Node built-ins are always allowed;
 * they are part of the runtime and cost nothing to resolve.
 */
export const ALLOWED_TOP_LEVEL_MAIN_REQUIRES: readonly string[] = ['electron']

/** Function bodies run when called, not when the bundle loads. */
const DEFERRED_NODE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
])

interface AstNode {
  readonly type: string
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
}

function requiredSpecifier(node: AstNode) {
  if (node.type !== 'CallExpression') return null
  const callee: unknown = Reflect.get(node, 'callee')
  const args: unknown = Reflect.get(node, 'arguments')
  if (!isAstNode(callee) || callee.type !== 'Identifier' || Reflect.get(callee, 'name') !== 'require') {
    return null
  }
  const first: unknown = Array.isArray(args) ? args[0] : undefined
  if (!isAstNode(first) || first.type !== 'Literal') return null
  const value: unknown = Reflect.get(first, 'value')
  return typeof value === 'string' ? value : null
}

/**
 * The `require()` specifiers a CommonJS bundle evaluates when it loads: every call outside a
 * function body, minified or not. Requires inside functions (Rolldown's lazy `__esmMin` and
 * `__commonJSMin` wrappers included) run only when that function does.
 */
export function topLevelRequires(source: string) {
  const specifiers = new Set<string>()
  const parsed = parseSync('bundle.cjs', source, { sourceType: 'script' })
  const syntaxError = parsed.errors[0]
  if (syntaxError) throw new Error(`Could not parse the bundle: ${syntaxError.message}`)
  const pending: unknown[] = [parsed.program]
  while (pending.length > 0) {
    const value = pending.pop()
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value
      pending.push(...items)
      continue
    }
    if (!isAstNode(value) || DEFERRED_NODE_TYPES.has(value.type)) continue
    const specifier = requiredSpecifier(value)
    if (specifier !== null) specifiers.add(specifier)
    for (const key of Object.keys(value)) {
      if (key === 'type') continue
      const child: unknown = Reflect.get(value, key)
      if (typeof child === 'object' && child !== null) pending.push(child)
    }
  }
  return [...specifiers].sort()
}

function isNodeBuiltin(specifier: string) {
  return specifier.startsWith('node:') || builtinModules.includes(specifier)
}

/** Top-level requires that are neither Node built-ins nor on the allowlist. */
export function disallowedTopLevelRequires(
  source: string,
  allowed: readonly string[] = ALLOWED_TOP_LEVEL_MAIN_REQUIRES,
) {
  return topLevelRequires(source).filter(
    (specifier) => !isNodeBuiltin(specifier) && !allowed.includes(specifier),
  )
}
