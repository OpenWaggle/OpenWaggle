/**
 * Entry point of every OpenWaggle process: package.json `main` names this file, so the desktop
 * app, the detached Session Host and each `openwaggle` CLI call run it before the main bundle.
 * It turns on V8's compile cache (A-F3), answers `--version`, `--help` and usage errors itself
 * (A-F15), launches the desktop app's Session Host when it would be launched anyway
 * (`boot/session-host-prelaunch.ts`), and otherwise loads `./index.js`, which keeps its own
 * startup order (Build identity first). Keep it free of OpenWaggle runtime imports: everything it
 * imports is compiled on every launch, before the cache exists. It reads `process.env` directly for the same reason; `env.ts`
 * would bring Effect Schema into the shim.
 */
// Must be first: names dev builds' userData before the Host prelaunch reads it.
import './apply-build-identity'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { app } from 'electron'
import {
  enableMainCompileCache,
  flushMainCompileCacheAfterLoad,
  type MainCompileCache,
} from './boot/main-compile-cache'
import { mainCompileCacheLocation } from './boot/main-compile-cache-location'
import { startSessionHostPrelaunch } from './boot/session-host-prelaunch'
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
const outcome = answerTopLevelCliInBoot({
  argv: process.argv,
  cliOutputFd: process.env.OPENWAGGLE_CLI_OUTPUT_FD,
  platform: process.platform,
})
if (outcome !== 'answered') {
  // The desktop app's Host starts now, while this process loads the main bundle.
  if (outcome === 'desktop-app') {
    startSessionHostPrelaunch({
      app,
      desktopApp: true,
      environment: process.env,
      platform: process.platform,
      executablePath: process.execPath,
      homeDirectory: homedir(),
      temporaryDirectory: tmpdir,
    })
  }
  createRequire(__filename)('./index.js')
  if (compileCache) {
    flushMainCompileCacheAfterLoad(compileCache, (callback, delayMs) =>
      setTimeout(callback, delayMs),
    )
  }
}
