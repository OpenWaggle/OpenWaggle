import { builtinModules } from 'node:module'

/**
 * Packages the Electron main bundle may `require()` at its top level, before any OpenWaggle code
 * runs. Everything else must load where it is first used: the GUI, the Session Host and every CLI
 * call evaluate this file's top level (startup-main.md, A-F4). Node built-ins are always allowed;
 * they are part of the runtime and cost nothing to resolve.
 */
export const ALLOWED_TOP_LEVEL_MAIN_REQUIRES: readonly string[] = ['electron']

const TOP_LEVEL_REQUIRE_PATTERN =
  /^(?:(?:let|const|var) [\w$]+ = )?(?:__toESM(?:\$\d+)?\()?require\("(?<specifier>[^"]+)"\)/u

/**
 * The `require()` specifiers at the top level of a Rolldown CommonJS bundle. Rolldown prints the
 * module scope without indentation and every wrapped module body indented, so a `require(` that
 * starts a line is evaluated when the bundle loads.
 */
export function topLevelRequires(source: string) {
  const specifiers = new Set<string>()
  for (const line of source.split('\n')) {
    const specifier = TOP_LEVEL_REQUIRE_PATTERN.exec(line)?.groups?.specifier
    if (specifier) specifiers.add(specifier)
  }
  return [...specifiers]
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
