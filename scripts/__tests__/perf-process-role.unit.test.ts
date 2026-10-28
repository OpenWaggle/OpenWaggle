import { describe, expect, it } from 'vitest'
import { appBundleOf, processRole } from '../perf/lib/perf-processes'

const EXECUTABLE = '/tmp/evidence/builds/integrated/mac-arm64/OpenWaggle.app/Contents/MacOS/OpenWaggle'
const BUNDLE = '/tmp/evidence/builds/integrated/mac-arm64/OpenWaggle.app'
const HELPER = `/private${BUNDLE}/Contents/Frameworks/OpenWaggle Dev (x) Helper (Renderer).app/Contents/MacOS/OpenWaggle Dev (x) Helper (Renderer)`

describe('perf process roles', () => {
  it('finds the app bundle of a packaged executable', () => {
    expect(appBundleOf(EXECUTABLE)).toBe(BUNDLE)
  })

  it.each([
    [`${EXECUTABLE} --use-mock-keychain`, 'gui-main'],
    [`/private${EXECUTABLE} --use-mock-keychain session-host-internal`, 'host'],
    [`${EXECUTABLE} -e require(x) {"model":"m","transformersPath":"/a/transformers"}`, 'host-embedding'],
    [`${HELPER} --type=renderer --lang=en`, 'renderer'],
    [`${HELPER} --type=gpu-process`, 'gpu'],
    [`${HELPER} --type=utility --utility-sub-type=network`, 'utility'],
    ['node /Users/me/.openwaggle/worktrees/OpenWaggle/abc/scripts/perf/fixtures/mcp-fixture-server/server.mjs', 'mcp-server'],
    ['npm exec @playwright/mcp@0.0.70', 'mcp-npm-wrapper'],
    ['/Applications/Electron.app/Contents/MacOS/Electron --type=renderer', 'mcp-server'],
  ])('classifies %s as %s', (command, role) => {
    expect(processRole(command, BUNDLE)).toBe(role)
  })
})
