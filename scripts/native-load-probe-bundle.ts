import { pathToFileURL } from 'node:url'
import { buildNodeScript, nodeScriptBundlePath } from './node-script-bundle'

/**
 * The native load probe runs inside Node and Electron, which load the native modules for their
 * own ABI. The native modules stay outside the bundle because the probe loads them with `require`
 * from the module root it is given.
 */
const PROBE_SOURCE = 'scripts/native-load-probe.ts'

export function nativeLoadProbeBundlePath(
  projectRoot: string,
  platform: NodeJS.Platform = process.platform,
) {
  return nodeScriptBundlePath(projectRoot, PROBE_SOURCE, platform)
}

/** Bundles the probe and returns the path of the module to run with Node or Electron. */
export function buildNativeLoadProbe(projectRoot: string) {
  return buildNodeScript(projectRoot, PROBE_SOURCE)
}

// `bun scripts/native-load-probe-bundle.ts` bundles the probe and prints the module path, for
// workflows that start the probe themselves.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildNativeLoadProbe(process.cwd()).then(
    (outfile) => console.log(outfile),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
