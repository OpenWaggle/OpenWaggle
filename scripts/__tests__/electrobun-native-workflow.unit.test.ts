import fs from 'node:fs'
import path from 'node:path'
import { assertMatching } from '@diegogbrisa/ts-match'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  DAWN_SOURCE,
  ELECTROBUN_SOURCE,
  MACOS_13_SDK,
  OWNED_DEPENDENCY_SOURCES,
} from '../../vendor/electrobun/sources'

const VENDOR = path.join(process.cwd(), 'vendor/electrobun')
const WORKFLOW = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/electrobun-native.yml'),
  'utf8',
)
const COMMIT = /^[0-9a-f]{40}$/u

describe('Electrobun native layer workflow', () => {
  it('builds every supported target, Linux in the Ubuntu 22.04 container', () => {
    const parsed: unknown = parse(WORKFLOW)
    assertMatching({ on: { workflow_call: {} } }, parsed)
    for (const target of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']) {
      expect(WORKFLOW).toContain(`target: ${target},`)
    }
    expect(WORKFLOW).toContain('args+=(--linux-container)')
  })

  it('fails on a floor regression in the devkit, the packaged probe and the macOS 13 SDK check', () => {
    const build = WORKFLOW.indexOf('name: Build the native layer')
    const devkitFloor = WORKFLOW.indexOf('--devkit "$OUT/devkit"')
    const sdk = WORKFLOW.indexOf('bun scripts/check-macos-sdk-symbols.ts')
    const upload = WORKFLOW.indexOf('actions/upload-artifact@', build)
    expect(devkitFloor).toBeGreaterThan(build)
    expect(sdk).toBeGreaterThan(devkitFloor)
    expect(upload).toBeGreaterThan(sdk)
    const floorSteps = WORKFLOW.match(/bun scripts\/check-native-platform-floor\.ts/gu) ?? []
    expect(floorSteps.length).toBeGreaterThanOrEqual(2)
    expect(WORKFLOW).not.toMatch(/check-native-platform-floor[^\n]*\|\| true/u)
  })

  it('downloads the macOS 13 SDK that vendor/electrobun/sources.ts pins', () => {
    expect(WORKFLOW).toContain(`MACOS_13_SDK_URL: ${MACOS_13_SDK.url}`)
    expect(WORKFLOW).toContain(`MACOS_13_SDK_SHA256: ${MACOS_13_SDK.sha256}`)
  })

  it('launches the Linux probe on Ubuntu 22.04 itself', () => {
    const parsed: unknown = parse(WORKFLOW)
    assertMatching({ jobs: { 'linux-floor': { 'runs-on': 'ubuntu-22.04' } } }, parsed)
  })
})

describe('vendor/electrobun pins', () => {
  it('pins commits, not tags, and names the pinned release in VERSION', () => {
    for (const source of [
      ELECTROBUN_SOURCE,
      DAWN_SOURCE,
      ...Object.values(OWNED_DEPENDENCY_SOURCES),
    ]) {
      expect(source.commit).toMatch(COMMIT)
    }
    const version = fs.readFileSync(path.join(VENDOR, 'VERSION'), 'utf8').trim()
    expect(version.startsWith(`${ELECTROBUN_SOURCE.tag.slice(1)}-openwaggle.`)).toBe(true)
  })

  it('keeps the patches as git am input: numbered, with a subject, and LF only', () => {
    const patches = fs.readdirSync(path.join(VENDOR, 'patches')).sort()
    expect(patches.length).toBeGreaterThan(0)
    patches.forEach((name, index) => {
      expect(name.startsWith(String(index + 1).padStart(4, '0'))).toBe(true)
      const text = fs.readFileSync(path.join(VENDOR, 'patches', name), 'utf8')
      expect(text).toMatch(/^From 0{40} /u)
      expect(text).toMatch(/^Subject: \[PATCH\] /mu)
      expect(text.includes('\r\n')).toBe(false)
    })
  })
})
