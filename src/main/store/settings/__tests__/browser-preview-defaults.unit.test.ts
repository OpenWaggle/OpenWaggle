import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import {
  SETTINGS_KEY_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
  SETTINGS_KEY_BROWSER_DEFAULT_APPEARANCE,
  SETTINGS_KEY_BROWSER_DEFAULT_VIEWPORT,
  SETTINGS_KEY_BROWSER_DEFAULT_ZOOM_FACTOR,
  SETTINGS_KEY_BROWSER_RECORDING_FRAME_RATE,
} from '../keys'
import { collectSettingsPatchWrites } from '../persistence-plan'
import { buildNextSettingsSnapshot, buildSettingsSnapshot } from '../snapshot'

describe('browser preview defaults', () => {
  it('matches the stable launcher defaults when no preferences are stored', () => {
    expect(buildSettingsSnapshot({}).settings).toMatchObject({
      browserDefaultViewport: { mode: 'fill' },
      browserDefaultZoomFactor: 1,
      browserDefaultAppearance: 'system',
      browserRecordingFrameRate: 30,
      browserAutoShowFloatingPreview: true,
    })
  })

  it('restores valid preferences and rejects corrupted persisted values independently', () => {
    expect(
      buildSettingsSnapshot({
        [SETTINGS_KEY_BROWSER_DEFAULT_VIEWPORT]: {
          mode: 'fixed',
          width: 1_440,
          height: 900,
          presetId: null,
        },
        [SETTINGS_KEY_BROWSER_DEFAULT_ZOOM_FACTOR]: 1.25,
        [SETTINGS_KEY_BROWSER_DEFAULT_APPEARANCE]: 'dark',
        [SETTINGS_KEY_BROWSER_RECORDING_FRAME_RATE]: 60,
        [SETTINGS_KEY_BROWSER_AUTO_SHOW_FLOATING_PREVIEW]: false,
      }).settings,
    ).toMatchObject({
      browserDefaultViewport: { mode: 'fixed', width: 1_440, height: 900, presetId: null },
      browserDefaultZoomFactor: 1.25,
      browserDefaultAppearance: 'dark',
      browserRecordingFrameRate: 60,
      browserAutoShowFloatingPreview: false,
    })

    expect(
      buildSettingsSnapshot({
        [SETTINGS_KEY_BROWSER_DEFAULT_VIEWPORT]: {
          mode: 'fixed',
          width: -1,
          height: 0,
          presetId: null,
        },
        [SETTINGS_KEY_BROWSER_DEFAULT_ZOOM_FACTOR]: 1.234,
        [SETTINGS_KEY_BROWSER_DEFAULT_APPEARANCE]: 'sepia',
        [SETTINGS_KEY_BROWSER_RECORDING_FRAME_RATE]: 120,
        [SETTINGS_KEY_BROWSER_AUTO_SHOW_FLOATING_PREVIEW]: 'yes',
      }).settings,
    ).toMatchObject({
      browserDefaultViewport: DEFAULT_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_SETTINGS.browserDefaultAppearance,
      browserRecordingFrameRate: DEFAULT_SETTINGS.browserRecordingFrameRate,
      browserAutoShowFloatingPreview: DEFAULT_SETTINGS.browserAutoShowFloatingPreview,
    })
  })

  it('sanitizes and writes every changed preference under its dedicated key', () => {
    const partial = {
      browserDefaultViewport: {
        mode: 'fixed' as const,
        width: 390,
        height: 844,
        presetId: null,
      },
      browserDefaultZoomFactor: 1.5 as const,
      browserDefaultAppearance: 'light' as const,
      browserRecordingFrameRate: 60 as const,
      browserAutoShowFloatingPreview: false,
    }
    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, partial)

    expect(collectSettingsPatchWrites(partial, next)).toEqual(
      expect.arrayContaining([
        { key: SETTINGS_KEY_BROWSER_DEFAULT_VIEWPORT, value: partial.browserDefaultViewport },
        { key: SETTINGS_KEY_BROWSER_DEFAULT_ZOOM_FACTOR, value: 1.5 },
        { key: SETTINGS_KEY_BROWSER_DEFAULT_APPEARANCE, value: 'light' },
        { key: SETTINGS_KEY_BROWSER_RECORDING_FRAME_RATE, value: 60 },
        { key: SETTINGS_KEY_BROWSER_AUTO_SHOW_FLOATING_PREVIEW, value: false },
      ]),
    )
  })
})
