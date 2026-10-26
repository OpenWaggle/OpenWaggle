import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { selectedScreenshots, WEBSITE_SCREENSHOTS } from '../website-screenshot-manifest'

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
