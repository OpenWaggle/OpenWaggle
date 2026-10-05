/**
 * Page-view and download-click beacons for openwaggle.ai, described in the Website section of
 * docs/specs/usage-statistics-fields.md. The site sets no cookies and uses no storage: each
 * beacon carries only the page path, the referring origin and the link's UTM tags, and nothing
 * is sent when the browser asks not to be tracked.
 */
import {
  WEB_BEACON_MAX_PATH_LENGTH,
  WEB_BEACON_MAX_UTM_LENGTH,
  WEB_BEACON_PATH,
  WEB_PRODUCTION_HOSTNAME,
  WEB_UTM_PARAMETERS,
  type WebBeacon,
  type WebBeaconUtm,
  type WebDownloadTarget,
  type WebUtmParameter,
} from '../../../functions/_lib/web-beacon-contract';

/** Local development hosts, where `wrangler pages dev` serves the endpoint too. */
const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);
const GITHUB_HOST = 'github.com';
const RAW_GITHUB_HOST = 'raw.githubusercontent.com';
const RELEASE_ASSET_PATH = /^\/OpenWaggle\/OpenWaggle\/releases\/(?:latest\/)?download\//iu;
const RELEASES_PATH = /^\/OpenWaggle\/OpenWaggle\/releases(?:\/|$)/iu;
const INSTALL_SCRIPT_PATH = /^\/OpenWaggle\/OpenWaggle\/(?:.+\/)?scripts\/install\.sh$/iu;
const INSTALLATION_PAGE_PATH = /^\/docs\/getting-started\/installation\/?$/u;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const MIDDLE_BUTTON = 1;

/** The browser's tracking-preference signals; any one of them turns the beacons off. */
export interface PrivacySignals {
  readonly doNotTrack?: unknown;
  readonly windowDoNotTrack?: unknown;
  readonly globalPrivacyControl?: unknown;
  readonly webdriver?: unknown;
}

/**
 * Whether this page may report: only on openwaggle.ai or a local development host, and never
 * with Do Not Track, Global Privacy Control or browser automation.
 */
export function usageBeaconAllowed(hostname: string, signals: PrivacySignals): boolean {
  if (hostname !== WEB_PRODUCTION_HOSTNAME && !LOCAL_HOSTNAMES.has(hostname)) return false;
  if (signals.doNotTrack === '1' || signals.windowDoNotTrack === '1') return false;
  return signals.globalPrivacyControl !== true && signals.webdriver !== true;
}

function parsedUrl(href: string, base?: string): URL | undefined {
  try {
    return new URL(href, base);
  } catch {
    return undefined;
  }
}

function isGitHub(url: URL) {
  return url.hostname === GITHUB_HOST;
}

/** What a link downloads, or `undefined` when it is not a download, release or install link. */
export function downloadTarget(href: string, pageUrl: string): WebDownloadTarget | undefined {
  const url = parsedUrl(href, pageUrl);
  if (url === undefined) return undefined;
  if (isGitHub(url) && RELEASE_ASSET_PATH.test(url.pathname)) return 'release_asset';
  if (isGitHub(url) && RELEASES_PATH.test(url.pathname)) return 'github_releases';
  const scriptHost = isGitHub(url) || url.hostname === RAW_GITHUB_HOST;
  if (scriptHost && INSTALL_SCRIPT_PATH.test(url.pathname)) return 'install_script';
  const sameSite = url.origin === parsedUrl(pageUrl)?.origin;
  return sameSite && INSTALLATION_PAGE_PATH.test(url.pathname) ? 'installation_page' : undefined;
}

/** The origin of the referring page; its path and query never leave the browser. */
export function referrerOrigin(referrer: string): string {
  const url = parsedUrl(referrer);
  return url !== undefined && (url.protocol === 'https:' || url.protocol === 'http:') ? url.origin : '';
}

/** UTM tags from a query string, without control characters and within the length limit. */
export function campaignTags(search: string): WebBeaconUtm {
  const parameters = new URLSearchParams(search);
  const tags: { [Parameter in WebUtmParameter]?: string } = {};
  for (const parameter of WEB_UTM_PARAMETERS) {
    const value = parameters.get(parameter)?.replace(CONTROL_CHARACTERS, '').trim();
    if (value) tags[parameter] = value.slice(0, WEB_BEACON_MAX_UTM_LENGTH);
  }
  return tags;
}

export interface PageContext {
  readonly href: string;
  readonly referrer: string;
}

function pageFields(page: PageContext) {
  const url = new URL(page.href);
  return {
    path: url.pathname.slice(0, WEB_BEACON_MAX_PATH_LENGTH),
    referrer: referrerOrigin(page.referrer),
    ...campaignTags(url.search),
  };
}

export function pageviewBeacon(page: PageContext): WebBeacon {
  return { type: 'pageview', ...pageFields(page) };
}

export function downloadClickBeacon(page: PageContext, target: WebDownloadTarget): WebBeacon {
  return { type: 'download_click', target, ...pageFields(page) };
}

export interface BeaconTransport {
  readonly sendBeacon?: (url: string, body: string) => boolean;
  readonly fetch?: (url: string, init: RequestInit) => Promise<unknown>;
}

/**
 * Sends a beacon with `navigator.sendBeacon`, which survives the page unloading, and falls back
 * to a keep-alive `fetch`. Text/plain keeps the request simple. `sendBeacon` always sends with
 * credentials mode `include`, so it would carry cookies for openwaggle.ai if the site set any;
 * it sets none. The `fetch` fallback omits credentials.
 */
export function sendUsageBeacon(beacon: WebBeacon, transport: BeaconTransport): void {
  const body = JSON.stringify(beacon);
  if (transport.sendBeacon?.(WEB_BEACON_PATH, body) === true) return;
  void transport
    .fetch?.(WEB_BEACON_PATH, {
      method: 'POST',
      body,
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    })
    .catch(() => undefined);
}

/** Everything the beacons read from the page, so tests can supply their own. */
export interface BeaconEnvironment {
  readonly hostname: string;
  readonly signals: PrivacySignals;
  readonly page: () => PageContext;
  readonly transport: BeaconTransport;
  /** Calls `listener` with the address of every link the visitor follows. */
  readonly onLinkFollowed: (listener: (href: string) => void) => void;
}

/** Reports this page view and every download link followed. Returns whether it reports. */
export function startUsageBeacon(environment: BeaconEnvironment): boolean {
  if (!usageBeaconAllowed(environment.hostname, environment.signals)) return false;
  sendUsageBeacon(pageviewBeacon(environment.page()), environment.transport);
  environment.onLinkFollowed((href) => {
    const page = environment.page();
    const target = downloadTarget(href, page.href);
    if (target !== undefined) sendUsageBeacon(downloadClickBeacon(page, target), environment.transport);
  });
  return true;
}

function followedLink(event: MouseEvent) {
  if (event.type === 'auxclick' && event.button !== MIDDLE_BUTTON) return undefined;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  return anchor instanceof HTMLAnchorElement ? anchor.href : undefined;
}

/** The live page: `window.location`, `document.referrer` and the browser's beacon APIs. */
export function browserBeaconEnvironment(): BeaconEnvironment {
  return {
    hostname: window.location.hostname,
    signals: {
      doNotTrack: navigator.doNotTrack,
      windowDoNotTrack: Reflect.get(window, 'doNotTrack'),
      globalPrivacyControl: Reflect.get(navigator, 'globalPrivacyControl'),
      webdriver: navigator.webdriver,
    },
    page: () => ({ href: window.location.href, referrer: document.referrer }),
    transport: {
      sendBeacon: (url, body) => navigator.sendBeacon(url, body),
      fetch: (url, init) => fetch(url, init),
    },
    onLinkFollowed: (listener) => {
      const handle = (event: MouseEvent) => {
        const href = followedLink(event);
        if (href !== undefined) listener(href);
      };
      document.addEventListener('click', handle, { capture: true });
      document.addEventListener('auxclick', handle, { capture: true });
    },
  };
}
