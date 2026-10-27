/**
 * Entry point of every OpenWaggle process: package.json `main` names this file, so the desktop
 * app, the detached Session Host and each `openwaggle` CLI call run it before the main bundle.
 * It only turns on V8's compile cache (A-F3) and then loads `./index.js`, which keeps its own
 * startup order (Build identity first). Keep it free of OpenWaggle runtime imports: everything it
 * imports is evaluated before the cache exists. It reads `process.env` directly for the same
 * reason; `env.ts` would bring Effect Schema into the shim.
 */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import {
  enableMainCompileCache,
  flushMainCompileCacheAfterLoad,
  type MainCompileCache,
} from './boot/main-compile-cache'
import { mainCompileCacheLocation } from './boot/main-compile-cache-location'

function startCompileCache(): MainCompileCache | null {
  try {
    return enableMainCompileCache(
      mainCompileCacheLocation({
        platform: process.platform,
        env: process.env,
        homeDirectory: homedir(),
        channel: BUILD_CHANNEL,
      }),
    )
  } catch {
    return null
  }
}

const compileCache = startCompileCache()
createRequire(__filename)('./index.js')
if (compileCache) {
  flushMainCompileCacheAfterLoad(compileCache, (callback, delayMs) => setTimeout(callback, delayMs))
}
