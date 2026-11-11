import fs from 'node:fs'
import path from 'node:path'
import { assertMatching } from '@diegogbrisa/ts-match'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const WORKFLOW = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8')

describe('desktop app release workflow native platform floor', () => {
  it('checks the native platform floor after every platform build and before upload', () => {
    const buildCommands = [
      'name: Package macOS with Electrobun',
      'name: Package Linux with Electrobun',
      'name: Package Windows with Electrobun',
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
    expect(WORKFLOW.match(/run: bun scripts\/check-native-platform-floor\.ts$/gmu)).toHaveLength(3)
  })

  it('builds Linux on Ubuntu 22.04 so native modules keep the glibc 2.35 floor', () => {
    const parsed: unknown = parse(WORKFLOW)
    assertMatching({ jobs: { 'build-linux': { 'runs-on': 'ubuntu-22.04' } } }, parsed)
  })

  it('builds macOS on a runner image GitHub still supports', () => {
    // macos-14 was retired: every release job on it was cancelled before any step ran, so
    // v1.0.0-beta.33 through beta.35 were tagged but never published.
    // Electrobun packages each architecture on its own CPU (electrobun-native.yml builds there too).
    const parsed: unknown = parse(WORKFLOW)
    assertMatching(
      {
        jobs: {
          'build-macos': {
            'runs-on': '${{ matrix.runner }}',
            strategy: {
              matrix: {
                include: [
                  { arch: 'arm64', runner: 'macos-15' },
                  { arch: 'x64', runner: 'macos-15-intel' },
                ],
              },
            },
          },
        },
      },
      parsed,
    )
  })
})
