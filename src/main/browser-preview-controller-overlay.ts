import type { BrowserPreviewControllerState } from '@shared/types/browser-preview'
import type { WebContents } from 'electron'

export const BROWSER_PREVIEW_CONTROLLER_OVERLAY_WORLD_ID = 1_705

const POINTER_ACTIVE_MS = 700

/**
 * Paints inside the guest so the indicator stays above its native WebContentsView. Coordinates
 * remain page CSS pixels; Chromium applies preview zoom and device-emulation scale exactly once.
 */
export function browserPreviewControllerOverlayScript(controller: BrowserPreviewControllerState) {
  const payload = JSON.stringify(controller)
  return `
(() => {
  const controller = ${payload};
  const stateKey = '__openwaggleBrowserPreviewControllerOverlay';
  let state = globalThis[stateKey];
  if (!state || !state.host || !state.host.isConnected) {
    const host = document.createElement('div');
    host.setAttribute('data-openwaggle-browser-controller', '');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:layout style;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = [
      ':host{all:initial}',
      '.pointer{position:absolute;top:0;left:0;width:20px;height:20px;transition:transform 100ms ease-out,opacity 180ms ease-out;will-change:transform,opacity}',
      '.pointer svg{position:relative;width:20px;height:20px;overflow:visible;filter:drop-shadow(0 1px 2px rgb(0 0 0 / 45%))}',
      '.pulse{position:absolute;top:1px;left:1px;width:16px;height:16px;border-radius:50%;background:rgb(120 164 255 / 32%);animation:ow-browser-click 520ms ease-out both}',
      '@keyframes ow-browser-click{from{opacity:.9;transform:scale(.25)}to{opacity:0;transform:scale(2.25)}}',
      '@media (prefers-reduced-motion:reduce){.pointer{transition:none}.pulse{animation:none;opacity:.35}}',
    ].join('');
    const pointer = document.createElement('div');
    pointer.className = 'pointer';
    pointer.style.opacity = '0';
    pointer.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5v15.4l4.1-4.1 2.8 6.1 3.1-1.5-2.8-5.8h5.9L5 3.5Z" fill="rgb(245 245 246)" stroke="rgb(74 113 206)" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    shadow.append(style, pointer);
    (document.documentElement || document.body).append(host);
    state = { host, pointer, fadeTimer: null };
    globalThis[stateKey] = state;
  }
  if (controller.kind === 'agent' && controller.pointer) {
    const x = Number.isFinite(controller.pointer.x) ? controller.pointer.x : 0;
    const y = Number.isFinite(controller.pointer.y) ? controller.pointer.y : 0;
    state.pointer.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    state.pointer.style.opacity = '1';
    if (state.fadeTimer !== null) clearTimeout(state.fadeTimer);
    state.fadeTimer = setTimeout(() => {
      state.pointer.style.opacity = controller.kind === 'agent' ? '.35' : '.18';
    }, ${String(POINTER_ACTIVE_MS)});
    if (controller.action === 'click') {
      const previous = state.pointer.querySelector('.pulse');
      if (previous) previous.remove();
      const pulse = document.createElement('span');
      pulse.className = 'pulse';
      state.pointer.prepend(pulse);
    }
  } else if (controller.kind === 'human' && state.pointer.style.opacity !== '0') {
    state.pointer.style.opacity = '.18';
  }
  return true;
})()
`
}

export async function synchronizeBrowserPreviewControllerOverlay(
  contents: WebContents,
  controller: BrowserPreviewControllerState,
) {
  if (contents.isDestroyed()) return false
  const result: unknown = await contents.executeJavaScriptInIsolatedWorld(
    BROWSER_PREVIEW_CONTROLLER_OVERLAY_WORLD_ID,
    [{ code: browserPreviewControllerOverlayScript(controller) }],
    true,
  )
  return result === true
}
