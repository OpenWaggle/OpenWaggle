import {
  createCodemodeExtension,
  createToolSearchExtension,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent'

/**
 * Pi's built-in extensions that OpenWaggle loads into every Pi session. The Pi CLI loads them on
 * its own; SDK sessions do not, so OpenWaggle supplies them the way the CLI does: as `builtin:<name>`
 * extensions, so Pi's `-builtin:<name>` in the `extensions` setting still disables one, and
 * replaceable, so an extension that registers the same tool takes over instead of conflicting.
 *
 * `codemode` and `tool_search` register inactive. The `defaultTools` setting activates codemode
 * (see openwaggle-pi-settings-app-overlay.ts); Pi's MCP extension activates either when a server's
 * exposure needs it.
 */
export const OPENWAGGLE_PI_BUILT_IN_EXTENSION_NAMES = ['codemode', 'tool-search'] as const

export function openWagglePiBuiltInExtensions(): InlineExtension[] {
  return [
    { name: 'codemode', factory: createCodemodeExtension(), replaceable: true, builtin: true },
    { name: 'tool-search', factory: createToolSearchExtension(), replaceable: true, builtin: true },
  ]
}

/**
 * Explicit `builtin:<name>` paths. Pi skips built-in extensions when `noExtensions` is set, which
 * OpenWaggle automation uses to keep third-party code out; built-ins are Pi itself, so automation
 * names them explicitly, like `pi -ne -e builtin:codemode`.
 */
export function openWagglePiBuiltInExtensionPaths(): string[] {
  return OPENWAGGLE_PI_BUILT_IN_EXTENSION_NAMES.map((name) => `builtin:${name}`)
}
