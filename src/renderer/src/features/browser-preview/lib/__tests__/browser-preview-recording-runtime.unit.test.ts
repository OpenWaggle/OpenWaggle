import { describe, expect, it } from 'vitest'
import {
  browserPreviewRecordingBitrate,
  selectBrowserPreviewRecordingMimeType,
} from '../browser-preview-recording-runtime'

describe('browser preview recording quality', () => {
  it('prefers supported H.264 encoding over AV1 and falls back to WebM', () => {
    expect(selectBrowserPreviewRecordingMimeType(() => true)).toBe('video/mp4;codecs=avc1')
    expect(selectBrowserPreviewRecordingMimeType((type) => type.startsWith('video/webm'))).toBe(
      'video/webm;codecs=vp9',
    )
  })

  it('scales the bitrate with captured resolution and frame rate', () => {
    expect(browserPreviewRecordingBitrate({ width: 1_920, height: 1_080, frameRate: 30 })).toBe(
      3_110_400,
    )
    expect(browserPreviewRecordingBitrate({ width: 3_840, height: 2_160, frameRate: 60 })).toBe(
      24_883_200,
    )
  })

  it('bounds encoder load and recovers from missing or invalid capture settings', () => {
    expect(browserPreviewRecordingBitrate({ width: 320, height: 200, frameRate: 30 })).toBe(
      2_500_000,
    )
    expect(browserPreviewRecordingBitrate({ width: 16_384, height: 16_384, frameRate: 60 })).toBe(
      50_000_000,
    )
    expect(browserPreviewRecordingBitrate()).toBe(3_110_400)
    expect(browserPreviewRecordingBitrate({ width: Number.NaN, height: -1, frameRate: 0 })).toBe(
      3_110_400,
    )
  })
})
