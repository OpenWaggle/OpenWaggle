import { useLayoutEffect } from 'react'

/** The id of the startup frame `index.html` paints before the renderer's scripts run. */
export const STATIC_STARTUP_FRAME_ID = 'startup-frame'

/**
 * The page's own startup frame covers the window until the app shows something else (W11). It is
 * not replaced by React's identical frame: the browser drops a first-paint image as the largest
 * contentful paint when its element goes before that paint is reported, which made the later
 * shell the window's LCP whenever the renderer was busy. Removed in a layout effect, so the
 * screen that replaces it is already in the document when it goes, and nothing blinks.
 */
export function useStaticStartupFrameUntil(covered: boolean) {
  useLayoutEffect(() => {
    if (!covered) document.getElementById(STATIC_STARTUP_FRAME_ID)?.remove()
  }, [covered])
}
