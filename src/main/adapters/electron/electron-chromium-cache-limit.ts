/**
 * The HTTP disk cache cap, on its own so the startup path (`AppPaths.setWebProfileData`, which
 * the boot shim reaches) loads no logger; the cache watcher is `electron-chromium-disk-cache.ts`.
 */
import type { CommandLine } from 'electron'

export const MEBIBYTE = 1024 * 1024

const DISK_CACHE_SIZE_SWITCH = 'disk-cache-size'

/**
 * Most bytes one Chromium session keeps in its HTTP cache. Unbounded, Chromium sizes it from the
 * free disk space: 1.2 GB in the default session and 853 MB in the browser preview partition were
 * observed.
 */
export const CHROMIUM_HTTP_CACHE_MAX_BYTES = 256 * MEBIBYTE
/**
 * Cap the HTTP disk cache of every Chromium session this process opens. Must run before the app is
 * ready; an explicit `--disk-cache-size` given on the command line wins.
 */
export function limitChromiumHttpDiskCache(
  commandLine: Pick<CommandLine, 'appendSwitch' | 'hasSwitch'>,
) {
  if (commandLine.hasSwitch(DISK_CACHE_SIZE_SWITCH)) return
  commandLine.appendSwitch(DISK_CACHE_SIZE_SWITCH, String(CHROMIUM_HTTP_CACHE_MAX_BYTES))
}
