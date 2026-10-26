import fs from 'node:fs'
import path from 'node:path'
import { assertMatching } from '@diegogbrisa/ts-match'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const WORKFLOW = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8')

describe('desktop app release workflow native platform floor', () => {
  it('checks the native platform floor after every platform build and before upload', () => {
    const buildCommands = [
      'pnpm exec electron-builder --mac --arm64 --x64 --publish never',
      'pnpm exec electron-builder --linux --publish never',
      'pnpm exec electron-builder --win --publish never',
    ]
    const guardStepNames = [
      'Check macOS native platform floor',
      'Check Linux native platform floor',
      'Check Windows native platform floor',
    ]

    for (const [index, buildCommand] of buildCommands.entries()) {
      const buildIndex = WORKFLOW.indexOf(buildCommand)
      const guardIndex = WORKFLOW.indexOf(guardStepNames[index] ?? '')
      const nextUploadIndex = WORKFLOW.indexOf('actions/upload-artifact@', buildIndex)
      expect(guardIndex).toBeGreaterThan(buildIndex)
      expect(nextUploadIndex).toBeGreaterThan(guardIndex)
    }
    expect(WORKFLOW.match(/run: pnpm exec tsx scripts\/check-native-platform-floor\.ts$/gmu)).toHaveLength(3)
  })

  it('builds Linux on Ubuntu 22.04 so native modules keep the glibc 2.35 floor', () => {
    const parsed: unknown = parse(WORKFLOW)
    assertMatching({ jobs: { 'build-linux': { 'runs-on': 'ubuntu-22.04' } } }, parsed)
  })
})
