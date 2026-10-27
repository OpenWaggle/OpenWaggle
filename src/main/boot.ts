/**
 * Entry point of every OpenWaggle process: package.json `main` names this file, so the desktop
 * app, the detached Session Host and each `openwaggle` CLI call run it before the main bundle.
 * It turns on V8's compile cache (A-F3), answers `--version`, `--help` and usage errors itself
 * (A-F15), and otherwise loads `./index.js`, which keeps its own startup order (Build identity
 * first). Keep it free of OpenWaggle runtime imports: everything it imports is compiled on every
 * launch, before the cache exists. It reads `process.env` directly for the same reason; `env.ts`
 * would bring Effect Schema into the shim.
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
import { answerTopLevelCliInBoot } from './boot-top-level-cli'

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
const answered = answerTopLevelCliInBoot({
  argv: process.argv,
  cliOutputFd: process.env.OPENWAGGLE_CLI_OUTPUT_FD,
  platform: process.platform,
})
if (!answered) {
  createRequire(__filename)('./index.js')
  if (compileCache) {
    flushMainCompileCacheAfterLoad(compileCache, (callback, delayMs) =>
      setTimeout(callback, delayMs),
    )
  }
}
