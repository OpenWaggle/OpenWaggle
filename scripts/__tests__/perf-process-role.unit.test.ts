import { describe, expect, it } from 'vitest'
import { appBundleOf, processRole } from '../perf/lib/perf-processes'

const BUNDLE = '/tmp/evidence/builds/integrated/stable-macos-arm64/OpenWaggle.app'
const EXECUTABLE = `${BUNDLE}/Contents/MacOS/OpenWaggle`
const BUN = `${BUNDLE}/Contents/MacOS/bun`
const HELPER = `/private${BUNDLE}/Contents/Frameworks/bun Helper (Renderer).app/Contents/MacOS/bun Helper (Renderer)`

describe('perf process roles', () => {
  it('finds the app bundle of a packaged executable', () => {
    expect(appBundleOf(EXECUTABLE)).toBe(BUNDLE)
  })

  it.each([
    [`${EXECUTABLE} --use-mock-keychain`, 'gui-main'],
    [`${BUN} ${BUNDLE}/Contents/Resources/main.js`, 'gui-main'],
    [
      `/private${BUN} ${BUNDLE}/Contents/Resources/app/out/main/index.js session-host-internal`,
      'host',
    ],
    [`${BUN} -e require(x) {"model":"m","transformersPath":"/a/transformers"}`, 'host-embedding'],
    [`${HELPER} --type=renderer --lang=en`, 'renderer'],
    [`${HELPER} --type=gpu-process`, 'gpu'],
    [`${HELPER} --type=utility --utility-sub-type=network`, 'utility'],
    [
      'node /Users/me/.openwaggle/worktrees/OpenWaggle/abc/scripts/perf/fixtures/mcp-fixture-server/server.mjs',
      'mcp-server',
    ],
    ['npm exec @playwright/mcp@0.0.70', 'mcp-npm-wrapper'],
    ['/Applications/Other.app/Contents/MacOS/Other --type=renderer', 'mcp-server'],
  ])('classifies %s as %s', (command, role) => {
    expect(processRole(command, BUNDLE)).toBe(role)
  })
})
