import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const PI_CODING_AGENT_PACKAGE = '@earendil-works/pi-coding-agent'

/**
 * Pi's installed package directory, looked up through Node's module search paths from `fromFile`.
 *
 * Pi finds its README, docs (including codemode's `codemode.md`), examples, themes, HTML export
 * templates, and its own `VERSION` by walking up from its module file to the nearest
 * `package.json`. Bundled into OpenWaggle's main chunk, that walk reaches OpenWaggle's
 * package.json instead. Pi's package exports neither `package.json` nor a CommonJS entry, so the
 * search paths are probed directly.
 */
export function findPiCodingAgentPackageDirectory(fromFile: string): string | undefined {
  const searchPaths = createRequire(fromFile).resolve.paths(PI_CODING_AGENT_PACKAGE) ?? []
  for (const searchPath of searchPaths) {
    const packageDirectory = join(searchPath, PI_CODING_AGENT_PACKAGE)
    if (existsSync(join(packageDirectory, 'package.json'))) return packageDirectory
  }
  return undefined
}
