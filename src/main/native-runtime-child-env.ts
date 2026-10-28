import { env, getSafeChildEnv } from './env'

/**
 * `getSafeChildEnv()` for a child that loads a native runtime (onnxruntime-node in the Session
 * embedding child): on Windows it also needs the system root to load DLLs, and the temp and
 * profile directories its caches resolve from, which `HOME`/`TMPDIR` do not provide there. No
 * secrets pass through.
 */
export function getNativeRuntimeChildEnv(
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  if (platform !== 'win32') return getSafeChildEnv()
  return {
    ...getSafeChildEnv(),
    SystemRoot: env.SystemRoot,
    TEMP: env.TEMP,
    TMP: env.TMP,
    USERPROFILE: env.USERPROFILE,
    LOCALAPPDATA: env.LOCALAPPDATA,
  }
}
