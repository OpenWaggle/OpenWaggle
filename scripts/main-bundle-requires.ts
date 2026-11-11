import { builtinModules } from 'node:module'
import { parseSync } from 'vite'
import { Schema } from '@shared/schema'

/**
 * Packages the main bundle may import at its top level, before any OpenWaggle code runs.
 * Everything else must load where it is first used: the GUI, the Session Host and every CLI
 * call evaluate this file's top level (startup-main.md, A-F4). Runtime built-ins are always
 * allowed; they are part of the runtime and cost nothing to resolve.
 */
export const ALLOWED_TOP_LEVEL_MAIN_REQUIRES: readonly string[] = []

/** Function bodies run when called, not when the bundle loads. */
const DEFERRED_NODE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
])

/** Statements that load their `source` when the module is evaluated. */
const STATIC_LOAD_NODE_TYPES = new Set([
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
  'ImportExpression',
])

interface AstNode {
  readonly type: string
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

const stringLiteralSchema = Schema.Struct({ type: Schema.Literal('Literal'), value: Schema.String })

/** `require`, or Bun's `import.meta.require`. */
const requireCalleeSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('Identifier'), name: Schema.Literal('require') }),
  Schema.Struct({
    type: Schema.Literal('MemberExpression'),
    object: Schema.Struct({ type: Schema.Literal('MetaProperty') }),
    property: Schema.Struct({ name: Schema.Literal('require') }),
  }),
)

/** `require('<specifier>')` or `import.meta.require('<specifier>')`. */
const requireCallSchema = Schema.Struct({
  type: Schema.Literal('CallExpression'),
  callee: requireCalleeSchema,
  arguments: Schema.NonEmptyArray(Schema.Unknown),
})

const staticLoadSchema = Schema.Struct({ source: stringLiteralSchema })

function stringLiteral(value: unknown) {
  return Schema.is(stringLiteralSchema)(value) ? value.value : null
}

/**
 * The specifier a node loads when it runs: a `require()` or `import.meta.require()` call, an
 * `import()`, or a static `import`/`export ... from`.
 */
function loadedSpecifier(node: AstNode) {
  if (node.type === 'CallExpression') {
    return Schema.is(requireCallSchema)(node) ? stringLiteral(node.arguments[0]) : null
  }
  if (STATIC_LOAD_NODE_TYPES.has(node.type) && Schema.is(staticLoadSchema)(node)) {
    return node.source.value
  }
  return null
}

function parsedProgram(source: string) {
  // The main bundle is an ES module; a CommonJS file parses as a script.
  for (const sourceType of ['module', 'script'] as const) {
    const parsed = parseSync('bundle.js', source, { sourceType })
    if (parsed.errors.length === 0) return parsed.program
  }
  const parsed = parseSync('bundle.js', source, { sourceType: 'module' })
  throw new Error(`Could not parse the bundle: ${parsed.errors[0]?.message ?? 'unknown error'}`)
}

/**
 * The specifiers a bundle loads when it is evaluated: every static import, and every
 * `require()`, `import.meta.require()` or `import()` outside a function body, minified or not.
 * Loads inside functions (lazy CommonJS wrappers included) run only when that function does.
 */
export function topLevelRequires(source: string) {
  const specifiers = new Set<string>()
  const pending: unknown[] = [parsedProgram(source)]
  while (pending.length > 0) {
    const value = pending.pop()
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value
      pending.push(...items)
      continue
    }
    if (!isAstNode(value) || DEFERRED_NODE_TYPES.has(value.type)) continue
    const specifier = loadedSpecifier(value)
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

function isRuntimeBuiltin(specifier: string) {
  return (
    specifier.startsWith('node:') ||
    specifier.startsWith('bun:') ||
    NODE_BUILTIN_MODULES.includes(specifier)
  )
}

/** Another chunk of the same build, beside this file; budgeted as part of the chunk graph. */
const SIBLING_PREFIX = './'

function isSiblingChunk(specifier: string) {
  return (
    specifier.startsWith(SIBLING_PREFIX) && !specifier.slice(SIBLING_PREFIX.length).includes('/')
  )
}

/** Top-level loads that are neither runtime built-ins, sibling chunks, nor on the allowlist. */
export function disallowedTopLevelRequires(
  source: string,
  allowed: readonly string[] = ALLOWED_TOP_LEVEL_MAIN_REQUIRES,
) {
  return topLevelRequires(source).filter(
    (specifier) =>
      !isRuntimeBuiltin(specifier) && !isSiblingChunk(specifier) && !allowed.includes(specifier),
  )
}
