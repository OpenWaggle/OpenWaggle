import { describe, expect, it, vi } from 'vitest'
import { terminateInlineVisualizationFrameProcess } from '../inline-visualization-process-termination'

const FRAME_ID = '31ec52dc-8ef2-4f5c-bb88-09f034a70bb7'
const FRAME_URL = `openwaggle-visualization://frame-${FRAME_ID}/document`

function frame(url: string, osProcessId: number) {
  return { url, osProcessId }
}

describe('inline visualization process termination', () => {
  it('terminates a separately isolated registered visualization renderer', () => {
    const killProcess = vi.fn()

    const terminated = terminateInlineVisualizationFrameProcess({
      frameId: FRAME_ID,
      registrationId: 'registration-1',
      mainFrame: frame('openwaggle://app/', 100),
      framesInSubtree: [frame(FRAME_URL, 200)],
      isRegistered: () => true,
      killProcess,
    })

    expect(terminated).toBe(true)
    expect(killProcess).toHaveBeenCalledExactlyOnceWith(200)
  })

  it.each([
    {
      name: 'the registration is stale',
      mainPid: 100,
      frames: [frame(FRAME_URL, 200)],
      registered: false,
    },
    {
      name: 'the frame shares the application renderer',
      mainPid: 100,
      frames: [frame(FRAME_URL, 100)],
      registered: true,
    },
    {
      name: 'the target is the Electron main process',
      mainPid: 100,
      frames: [frame(FRAME_URL, process.pid)],
      registered: true,
    },
    {
      name: 'the process contains another frame',
      mainPid: 100,
      frames: [frame(FRAME_URL, 200), frame('openwaggle://app/embedded', 200)],
      registered: true,
    },
  ])('refuses termination when $name', ({ mainPid, frames, registered }) => {
    const killProcess = vi.fn()

    const terminated = terminateInlineVisualizationFrameProcess({
      frameId: FRAME_ID,
      registrationId: 'registration-1',
      mainFrame: frame('openwaggle://app/', mainPid),
      framesInSubtree: frames,
      isRegistered: () => registered,
      killProcess,
    })

    expect(terminated).toBe(false)
    expect(killProcess).not.toHaveBeenCalled()
  })
})
