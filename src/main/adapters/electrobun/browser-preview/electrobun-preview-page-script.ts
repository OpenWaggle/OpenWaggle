import type { BrowserPreviewShortcutBindings } from '@shared/types/browser-preview'

/**
 * The script OpenWaggle runs in every frame of a CEF preview, in an isolated world the page cannot
 * reach (`Page.addScriptToEvaluateOnNewDocument` with `worldName`, and a `Runtime.addBinding` that
 * exists only in that world). Electron sees a preview's keys in `before-input-event` and its title
 * and audio natively; CEF previews report them through this script instead:
 *
 * - keys: it stops, before the page sees them, the chords the owner page claimed and the preview's
 *   own shortcuts, and reports them, plus the key up of a claimed key, for the main process to act
 *   on with the shared `decideBrowserPreviewKeyInput`;
 * - title: the top frame reports `document.title` whenever it changes;
 * - audio: while muted it mutes every media element, including ones added later, and unmutes the
 *   ones it muted afterwards. Web Audio is not muted: CDP has no page audio switch.
 */
export const BROWSER_PREVIEW_WORLD_NAME = 'openwaggle-browser-preview'
export const BROWSER_PREVIEW_HOST_BINDING = '__openwaggleBrowserPreviewHost'

/** One claimable chord, with `mod` already resolved for the platform. */
export interface BrowserPreviewPageChord {
  readonly key: string
  readonly ctrl: boolean
  readonly meta: boolean
  readonly alt: boolean
  readonly shift: boolean
}

export interface BrowserPreviewPageConfig {
  readonly chords: readonly BrowserPreviewPageChord[]
  readonly muted: boolean
  readonly isMac: boolean
}

/** Resolves the owner's bindings into the chords the page script matches. */
export function browserPreviewPageChords(
  bindings: BrowserPreviewShortcutBindings,
  isMac: boolean,
): readonly BrowserPreviewPageChord[] {
  return bindings.map((binding) => {
    const key = binding.key.trim().toLowerCase()
    return {
      key: key === 'esc' ? 'escape' : key,
      ctrl: binding.ctrl === true || (binding.mod === true && !isMac),
      meta: binding.meta === true || (binding.mod === true && isMac),
      alt: binding.alt === true,
      shift: binding.shift === true,
    }
  })
}

const PAGE_SCRIPT_BODY = String.raw`
  const host = globalThis[HOST_BINDING];
  if (typeof host !== 'function' || globalThis.__openwaggleBrowserPreview) return;
  const state = { chords: config.chords, muted: config.muted, isMac: config.isMac };
  const claimed = new Set();
  const report = (message) => { try { host(JSON.stringify(message)); } catch {} };
  const codeAliases = { BracketLeft: ['['], BracketRight: [']'], Equal: ['=', '+'], Minus: ['-'] };
  const eventKeys = (event) => {
    const key = String(event.key).toLowerCase();
    const keys = new Set([key === 'esc' ? 'escape' : key]);
    const letter = /^Key([A-Z])$/.exec(event.code);
    if (letter && !/^[a-z]$/.test(key)) keys.add(letter[1].toLowerCase());
    const digit = /^Digit([0-9])$/.exec(event.code);
    if (digit) keys.add(digit[1]);
    for (const alias of codeAliases[event.code] || []) keys.add(alias);
    return keys;
  };
  const matchesChord = (event) => {
    if (event.isComposing || event.getModifierState('AltGraph')) return false;
    const keys = eventKeys(event);
    return state.chords.some((chord) =>
      chord.ctrl === event.ctrlKey && chord.meta === event.metaKey && chord.alt === event.altKey &&
      (chord.shift === event.shiftKey || (chord.key === '+' && event.shiftKey)) && keys.has(chord.key));
  };
  const isNativeChord = (event) => {
    if (event.isComposing || event.shiftKey) return false;
    const key = String(event.key).toLowerCase();
    const primary = state.isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (primary && !event.altKey && (key === 'l' || key === 'r' || key === 'w')) return true;
    return event.altKey && !event.ctrlKey && !event.metaKey && (key === 'arrowleft' || key === 'arrowright');
  };
  const identity = (event) => event.code ? 'code:' + event.code : 'key:' + event.key + ':location:' + event.location;
  const forward = (event, type) => report({
    kind: 'key', type, key: event.key, code: event.code, location: event.location,
    alt: event.altKey, control: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey,
    isComposing: event.isComposing, isAutoRepeat: event.repeat,
  });
  const stop = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    if (matchesChord(event)) { claimed.add(identity(event)); stop(event); forward(event, 'keyDown'); return; }
    if (isNativeChord(event)) { stop(event); forward(event, 'keyDown'); }
  }, true);
  addEventListener('keyup', (event) => {
    if (!event.isTrusted) return;
    if (claimed.delete(identity(event))) { stop(event); forward(event, 'keyUp'); return; }
    if (isNativeChord(event)) stop(event);
  }, true);
  addEventListener('blur', () => claimed.clear(), true);
  const mutedByPreview = new Set();
  const mute = (media) => { if (!media.muted) { media.muted = true; mutedByPreview.add(media); } };
  const muteAll = () => {
    if (state.muted) { for (const media of document.querySelectorAll('audio, video')) mute(media); return; }
    for (const media of mutedByPreview) media.muted = false;
    mutedByPreview.clear();
  };
  addEventListener('play', (event) => { if (state.muted && event.target instanceof HTMLMediaElement) mute(event.target); }, true);
  if (window.top === window) {
    let lastTitle = null;
    const reportTitle = () => { if (document.title !== lastTitle) { lastTitle = document.title; report({ kind: 'title', title: lastTitle }); } };
    new MutationObserver(() => { reportTitle(); muteAll(); }).observe(document, { subtree: true, childList: true, characterData: true });
    addEventListener('DOMContentLoaded', () => { reportTitle(); muteAll(); }, true);
  }
  globalThis.__openwaggleBrowserPreview = {
    configure(next) { state.chords = next.chords; state.muted = next.muted; muteAll(); },
  };
`

/** The page script with its starting configuration. */
export function browserPreviewPageScript(config: BrowserPreviewPageConfig) {
  return `(() => { const HOST_BINDING = ${JSON.stringify(BROWSER_PREVIEW_HOST_BINDING)}; const config = ${JSON.stringify(config)};${PAGE_SCRIPT_BODY}})()`
}

/** Reconfigures the script already running in a frame. */
export function browserPreviewPageConfigureScript(config: BrowserPreviewPageConfig) {
  return `globalThis.__openwaggleBrowserPreview?.configure(${JSON.stringify(config)})`
}
