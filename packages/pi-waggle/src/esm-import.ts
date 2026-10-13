/**
 * A real `import()`, which a CommonJS module can use to load an ES module. TypeScript compiles a
 * literal `import()` to `require()` in pi-waggle's CommonJS build, and `require()` cannot load a
 * package whose exports have only an `import` condition, such as pi-ai. Built with `Function`, this
 * one is not compiled, and resolves from this file as a literal one would.
 */
export function importEsm(specifier: string): Promise<unknown> {
  // Created on use, so loading pi-waggle never evaluates code where that is not allowed.
  const dynamicImport = new Function('specifier', 'return import(specifier)')
  const loaded: unknown = Reflect.apply(dynamicImport, undefined, [specifier])
  return Promise.resolve(loaded)
}
