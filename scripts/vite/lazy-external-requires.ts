import type { Plugin } from 'vite'

/**
 * Prefix of the virtual CommonJS modules that stand in for a lazily required external package.
 * Rolldown treats the `\0` prefix as "not a file", so no other plugin tries to load these ids.
 */
export const LAZY_EXTERNAL_MODULE_PREFIX = '\0openwaggle-lazy-external:'

/** Packages whose first static import stays hoisted to the top of the main bundle. */
export const EAGER_MAIN_EXTERNALS: readonly string[] = ['electron']

/** The CommonJS body of the virtual module that requires `specifier` only when first needed. */
export function lazyExternalModuleSource(specifier: string) {
  return `module.exports = require(${JSON.stringify(specifier)});\n`
}

/**
 * Keeps external packages out of the main bundle's startup path.
 *
 * The main bundle is one CommonJS file (`codeSplitting: false`, MEMORY "Pi lazy-loads some
 * Node-only modules"). Rolldown hoists every statically imported external to a top-level
 * `require()`, even when the importing module sits inside a lazy `__esmMin` initializer, so the
 * GUI, the Session Host and every CLI call used to load undici, zod, electron-updater, remark,
 * sharp and the rest before any OpenWaggle code ran (startup-main.md, A-F4).
 *
 * This plugin routes each static import of a listed external through a tiny virtual CommonJS
 * module that requires the package. Rolldown wraps CommonJS modules in `__commonJSMin`, and a
 * `require()` inside one stays where it is, so the package now loads when its importer is first
 * initialized. The value the importer receives is the same `require()` result as before, so
 * interop does not change. Dynamic `import()` and `require()` calls are left alone; they are
 * already lazy. The externals this plugin owns must not also be in Rolldown's `external` list,
 * because a raw-id match there is decided before any `resolveId` hook runs.
 */
export function lazyExternalRequiresPlugin(isLazyExternal: (specifier: string) => boolean): Plugin {
  return {
    name: 'openwaggle:lazy-external-requires',
    enforce: 'pre',
    apply: 'build',
    resolveId: {
      order: 'pre',
      handler(source, importer, options) {
        // Exact ids only, like Rolldown's string `external` list this replaces: a subpath or a
        // `?raw` import of an external package (`zod/v4`, `lucide/LICENSE?raw`) stays bundled.
        if (!isLazyExternal(source)) return null
        const kind: unknown = Reflect.get(options, 'kind')
        const fromLazyModule = importer?.startsWith(LAZY_EXTERNAL_MODULE_PREFIX) === true
        if (kind === 'import-statement' && !fromLazyModule) {
          return `${LAZY_EXTERNAL_MODULE_PREFIX}${source}`
        }
        return { id: source, external: true }
      },
    },
    load(id) {
      if (!id.startsWith(LAZY_EXTERNAL_MODULE_PREFIX)) return null
      return {
        code: lazyExternalModuleSource(id.slice(LAZY_EXTERNAL_MODULE_PREFIX.length)),
        moduleType: 'js',
      }
    },
  }
}
