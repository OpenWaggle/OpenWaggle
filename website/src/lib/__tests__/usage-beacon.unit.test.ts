import { describe, expect, it } from 'vitest';
import {
  type BeaconEnvironment,
  type BeaconTransport,
  campaignTags,
  downloadTarget,
  referrerOrigin,
  sendUsageBeacon,
  startUsageBeacon,
  usageBeaconAllowed,
} from '../usage-beacon';

const PAGE = 'https://openwaggle.ai/docs/getting-started/installation/';

function recordingTransport(sendBeaconResult = true) {
  const sent: { url: string; body: string; via: string }[] = [];
  const transport: BeaconTransport = {
    sendBeacon: (url, body) => {
      sent.push({ url, body, via: 'sendBeacon' });
      return sendBeaconResult;
    },
    fetch: async (url, init) => {
      sent.push({ url, body: String(init.body), via: 'fetch' });
      return undefined;
    },
  };
  return { sent, transport };
}

function environment(overrides: Partial<BeaconEnvironment> = {}) {
  const { sent, transport } = recordingTransport();
  const listeners: ((href: string) => void)[] = [];
  const beaconEnvironment: BeaconEnvironment = {
    hostname: 'openwaggle.ai',
    signals: { doNotTrack: null, webdriver: false },
    page: () => ({ href: `${PAGE}?utm_source=hn&utm_medium=social&ref=x`, referrer: 'https://news.ycombinator.com/item?id=1' }),
    transport,
    onLinkFollowed: (listener) => listeners.push(listener),
    ...overrides,
  };
  const follow = (href: string) => {
    for (const listener of listeners) listener(href);
  };
  return { sent, listeners, beaconEnvironment, follow };
}

describe('website beacons', () => {
  it('sends a page view with the path, referring origin and UTM tags only', () => {
    const { sent, beaconEnvironment } = environment();

    expect(startUsageBeacon(beaconEnvironment)).toBe(true);
    expect(sent).toEqual([
      {
        url: '/api/v1/web',
        via: 'sendBeacon',
        body: JSON.stringify({
          type: 'pageview',
          path: '/docs/getting-started/installation/',
          referrer: 'https://news.ycombinator.com',
          utm_source: 'hn',
          utm_medium: 'social',
        }),
      },
    ]);
  });

  it('sends a download click for release, install-script and download links only', () => {
    const { sent, beaconEnvironment, follow } = environment();
    startUsageBeacon(beaconEnvironment);
    follow('https://github.com/OpenWaggle/OpenWaggle/releases');
    follow('https://github.com/OpenWaggle/OpenWaggle/issues');
    follow('/docs/getting-started/installation/');

    const clicks = sent.slice(1).map(({ body }) => JSON.parse(body));
    expect(clicks.map(({ type, target }) => [type, target])).toEqual([
      ['download_click', 'github_releases'],
      ['download_click', 'installation_page'],
    ]);
  });

  it.each([
    [{ doNotTrack: '1' }],
    [{ windowDoNotTrack: '1' }],
    [{ globalPrivacyControl: true }],
    [{ webdriver: true }],
  ])('sends nothing with %j', (signals) => {
    const { sent, listeners, beaconEnvironment } = environment({ signals });

    expect(startUsageBeacon(beaconEnvironment)).toBe(false);
    expect(sent).toEqual([]);
    expect(listeners).toEqual([]);
  });

  it('reports only from openwaggle.ai and local development', () => {
    expect(usageBeaconAllowed('openwaggle.ai', {})).toBe(true);
    expect(usageBeaconAllowed('localhost', {})).toBe(true);
    expect(usageBeaconAllowed('abc.openwaggle-website.pages.dev', {})).toBe(false);
    expect(usageBeaconAllowed('www.openwaggle.ai', {})).toBe(false);
  });

  it('falls back to a keep-alive fetch when sendBeacon declines', () => {
    const { sent, transport } = recordingTransport(false);
    sendUsageBeacon({ type: 'pageview', path: '/', referrer: '' }, transport);

    expect(sent.map(({ via }) => via)).toEqual(['sendBeacon', 'fetch']);
  });
});

describe('download links', () => {
  it.each([
    ['https://github.com/OpenWaggle/OpenWaggle/releases', 'github_releases'],
    ['https://github.com/OpenWaggle/OpenWaggle/releases/tag/v1.0.0-beta.4', 'github_releases'],
    ['https://github.com/OpenWaggle/OpenWaggle/releases/download/v1.0.0/openwaggle-1.0.0-arm64.dmg', 'release_asset'],
    ['https://github.com/OpenWaggle/OpenWaggle/releases/latest/download/latest-mac.yml', 'release_asset'],
    ['https://github.com/OpenWaggle/OpenWaggle/blob/main/scripts/install.sh', 'install_script'],
    ['https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh', 'install_script'],
    ['/docs/getting-started/installation/', 'installation_page'],
    ['https://openwaggle.ai/docs/getting-started/installation', 'installation_page'],
  ])('classifies %s as %s', (href, target) => {
    expect(downloadTarget(href, PAGE)).toBe(target);
  });

  it.each([
    'https://github.com/OpenWaggle/OpenWaggle',
    'https://github.com/someone/else/releases',
    'https://evil.example/docs/getting-started/installation/',
    '/docs/getting-started/first-run/',
    'mailto:privacy@openwaggle.ai',
  ])('ignores %s', (href) => {
    expect(downloadTarget(href, PAGE)).toBeUndefined();
  });
});

describe('beacon fields', () => {
  it('keeps only the referring origin', () => {
    expect(referrerOrigin('https://www.google.com/search?q=openwaggle')).toBe('https://www.google.com');
    expect(referrerOrigin('')).toBe('');
    expect(referrerOrigin('android-app://com.example')).toBe('');
  });

  it('reads UTM tags without control characters and within the length limit', () => {
    expect(campaignTags(`?utm_campaign=${'x'.repeat(200)}&utm_term=a%0Ab&other=1&utm_content=`)).toEqual({
      utm_campaign: 'x'.repeat(128),
      utm_term: 'ab',
    });
  });
});
