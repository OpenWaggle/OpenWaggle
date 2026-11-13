/** Packaged-app contents for the native platform-floor and native dependency tests. */
import type { PackagedAppFiles } from '../packaged-native-dependencies'

export function packageJson(name: string, optionalDependencies: readonly string[] = []) {
  return JSON.stringify({
    name,
    optionalDependencies: Object.fromEntries(
      optionalDependencies.map((dependency) => [dependency, '1.0.0']),
    ),
  })
}

/** `files` maps app-relative paths (`node_modules/sharp/package.json`) to contents. */
export function appFiles(files: Readonly<Record<string, string>>) {
  const byPath = new Map(Object.entries(files).map(([file, contents]) => [`/${file}`, contents]))
  return {
    files: new Set(byPath.keys()),
    readFile: async (file) => Buffer.from(byPath.get(file) ?? ''),
  } satisfies PackagedAppFiles
}
