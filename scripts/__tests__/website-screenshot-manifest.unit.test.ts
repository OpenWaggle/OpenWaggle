import { readdirSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  publishScreenshots,
  selectedScreenshots,
  WEBSITE_SCREENSHOTS,
} from '../website-screenshot-manifest'

const SCREENSHOT_DIRECTORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'website',
  'public',
  'screenshots',
)

describe('website screenshot manifest', () => {
  it('captures exactly the screenshots the website ships', () => {
    const shipped = readdirSync(SCREENSHOT_DIRECTORY).filter((file) => file.endsWith('.png'))
    expect([...WEBSITE_SCREENSHOTS].sort()).toEqual(shipped.sort())
  })

  it('captures every screenshot unless --only names some', () => {
    expect(selectedScreenshots([])).toEqual(WEBSITE_SCREENSHOTS)
    expect(selectedScreenshots(['--only', 'session-summary,hive-sessions'])).toEqual([
      'hive-sessions.png',
      'session-summary.png',
    ])
  })

  it('refuses a screenshot name it does not know instead of capturing nothing', () => {
    expect(() => selectedScreenshots(['--only', 'hive-session'])).toThrow('Unknown screenshot')
    expect(() => selectedScreenshots(['--only'])).toThrow('Unknown screenshot')
  })
})

describe('publishing captured screenshots', () => {
  let scratch = ''

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-shots-publish-'))
    await fs.mkdir(path.join(scratch, 'staging'))
    await fs.mkdir(path.join(scratch, 'website'))
    await fs.writeFile(path.join(scratch, 'website', 'hive-sessions.png'), 'old hive')
    await fs.writeFile(path.join(scratch, 'website', 'session-summary.png'), 'old summary')
  })

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true })
  })

  it('replaces the website images only once every selected capture exists', async () => {
    await fs.writeFile(path.join(scratch, 'staging', 'hive-sessions.png'), 'new hive')
    await expect(
      publishScreenshots({
        stagingDir: path.join(scratch, 'staging'),
        outputDir: path.join(scratch, 'website'),
        screenshots: ['hive-sessions.png', 'session-summary.png'],
      }),
    ).rejects.toThrow('session-summary.png')
    expect(await fs.readFile(path.join(scratch, 'website', 'hive-sessions.png'), 'utf8')).toBe(
      'old hive',
    )

    await fs.writeFile(path.join(scratch, 'staging', 'session-summary.png'), 'new summary')
    await publishScreenshots({
      stagingDir: path.join(scratch, 'staging'),
      outputDir: path.join(scratch, 'website'),
      screenshots: ['hive-sessions.png', 'session-summary.png'],
    })
    expect(await fs.readFile(path.join(scratch, 'website', 'hive-sessions.png'), 'utf8')).toBe(
      'new hive',
    )
    expect(await fs.readFile(path.join(scratch, 'website', 'session-summary.png'), 'utf8')).toBe(
      'new summary',
    )
  })
})
