import { describe, expect, it } from 'vitest'
import {
  resolveBrowserPreviewDeviceLayout,
  resolveBrowserPreviewResizableDeviceLayout,
  resolveBrowserPreviewResizeArea,
  responsiveBrowserPreviewViewport,
} from '../browser-preview-device-layout'

describe('resolveBrowserPreviewDeviceLayout', () => {
  it('fills the available surface without presentation scaling by default', () => {
    expect(
      resolveBrowserPreviewDeviceLayout({ width: 700.4, height: 500.4 }, { mode: 'fill' }),
    ).toEqual({
      x: 0,
      y: 0,
      width: 700,
      height: 500,
      scale: 1,
      fillsContainer: true,
    })
  })

  it('centers and fits a tall device while retaining its requested CSS dimensions', () => {
    expect(
      resolveBrowserPreviewDeviceLayout(
        { width: 700, height: 500 },
        { mode: 'fixed', width: 390, height: 844, presetId: 'iphone-12-pro' },
      ),
    ).toEqual({
      x: 235,
      y: 0,
      width: 231,
      height: 500,
      scale: 500 / 844,
      fillsContainer: false,
    })
  })

  it('includes page zoom in the fitted presentation footprint', () => {
    const layout = resolveBrowserPreviewDeviceLayout(
      { width: 900, height: 700 },
      { mode: 'fixed', width: 800, height: 600, presetId: null },
      1.25,
    )

    expect(layout).toEqual({
      x: 0,
      y: 13,
      width: 900,
      height: 675,
      scale: 0.9,
      fillsContainer: false,
    })
  })

  it('enters responsive device mode at the current CSS viewport size', () => {
    expect(responsiveBrowserPreviewViewport({ width: 750, height: 500 }, 1.25)).toEqual({
      mode: 'fixed',
      width: 600,
      height: 400,
      presetId: null,
    })
  })

  it('reserves five resize rails around a fixed viewport', () => {
    expect(resolveBrowserPreviewResizeArea({ width: 700, height: 500 })).toEqual({
      width: 680,
      height: 490,
    })
    expect(
      resolveBrowserPreviewResizableDeviceLayout(
        { width: 700, height: 500 },
        { mode: 'fixed', width: 400, height: 300, presetId: null },
      ),
    ).toEqual({
      x: 150,
      y: 95,
      width: 400,
      height: 300,
      scale: 1,
      fillsContainer: false,
    })
  })

  it('fits oversized CSS dimensions inside the rail area without changing their identity', () => {
    const layout = resolveBrowserPreviewResizableDeviceLayout(
      { width: 700, height: 500 },
      { mode: 'fixed', width: 1_200, height: 600, presetId: null },
      1.25,
    )

    expect(layout.x).toBe(10)
    expect(layout.y).toBe(75)
    expect(layout.width).toBe(680)
    expect(layout.height).toBe(340)
    expect(layout.scale).toBeCloseTo(680 / 1_500)
  })
})
