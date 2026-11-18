import { builtinModules } from 'node:module'
import { parseSync } from 'vite'
import { Schema } from '@shared/schema'

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
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

/** `require('<specifier>')`: a call of the `require` identifier with a string literal first. */
const requireCallSchema = Schema.Struct({
  type: Schema.Literal('CallExpression'),
  callee: Schema.Struct({ type: Schema.Literal('Identifier'), name: Schema.Literal('require') }),
  arguments: Schema.NonEmptyArray(
    Schema.Struct({ type: Schema.Literal('Literal'), value: Schema.Unknown }),
  ),
})

function requiredSpecifier(node: AstNode) {
  if (!Schema.is(requireCallSchema)(node)) return null
  const [{ value }] = node.arguments
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

/*
 * Bun lists its own `bun:` modules and the npm packages it reimplements (`ws`, `undici`) among the
 * built-ins. The main bundle loads those packages from node_modules, so they count as requires.
 */
const BUN_REIMPLEMENTED_PACKAGES = new Set(['undici', 'ws'])
const NODE_BUILTIN_MODULES = builtinModules.filter(
  (name) => name !== 'bun' && !name.startsWith('bun:') && !BUN_REIMPLEMENTED_PACKAGES.has(name),
)

function isNodeBuiltin(specifier: string) {
  return specifier.startsWith('node:') || NODE_BUILTIN_MODULES.includes(specifier)
}

/** Another chunk of the same build, beside this file; budgeted as part of the chunk graph. */
const SIBLING_PREFIX = './'

function isSiblingChunk(specifier: string) {
  return (
    specifier.startsWith(SIBLING_PREFIX) && !specifier.slice(SIBLING_PREFIX.length).includes('/')
  )
}

/** Top-level requires that are neither Node built-ins, sibling chunks, nor on the allowlist. */
export function disallowedTopLevelRequires(
  source: string,
  allowed: readonly string[] = ALLOWED_TOP_LEVEL_MAIN_REQUIRES,
) {
  return topLevelRequires(source).filter(
    (specifier) =>
      !isNodeBuiltin(specifier) && !isSiblingChunk(specifier) && !allowed.includes(specifier),
  )
}
