/**
 * Probe main process. `PROBE_MODE=adapter` runs OpenWaggle's Electrobun Browser preview adapter
 * (adapter-probe.ts); otherwise the probe drives a CEF preview over raw CDP (cdp-probe.ts).
 */
if (process.env.PROBE_MODE === 'adapter') await import('./adapter-probe')
else await import('./cdp-probe')
