/** Advertised on the search field, matching the prototype. */
export const SIDEBAR_SEARCH_HOTKEY_LABEL = '\u2318F'

export const SIDEBAR_LAYOUT = {
  /**
   * 316px, up from 272px.
   *
   * Two-line rows need it. Measured against the prototype's fixtures, 272px left the title
   * 198px and truncated the second line of the busiest row; 296px was the narrowest width
   * where nothing truncated; 316px is the width the approved design was drawn at and leaves
   * the title 242px.
   */
  WIDTH_CLASS: 'w-[316px]',
  DRAG_REGION_HEIGHT: 32,
  /**
   * Breathing room under the lockup, above New session. Kept small: it is dead space in
   * a windowed sidebar, where every pixel here is a session row that cannot be reached.
   */
  FULLSCREEN_SPACER_HEIGHT: 8,
  WINDOWED_SPACER_HEIGHT: 2,
}
