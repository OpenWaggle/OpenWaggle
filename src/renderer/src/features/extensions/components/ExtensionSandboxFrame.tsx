import type { ResolvedExtensionRouteContribution } from '../lib/extension-route-resolution'

export const EXTENSION_ROUTE_IFRAME_SANDBOX = 'allow-scripts'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function routeContextJson(contribution: ResolvedExtensionRouteContribution) {
  const context = {
    extensionId: contribution.entry.extensionId,
    contributionId: contribution.entry.contributionId,
    title: contribution.entry.title,
    lane: contribution.lane,
    entryPath: contribution.entryPath,
  }
  return JSON.stringify(context)
}

function escapeScriptJson(value: string) {
  return value
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

export function createExtensionRouteSrcDoc(contribution: ResolvedExtensionRouteContribution) {
  const entry = contribution.entry
  const contextJson = routeContextJson(contribution)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(entry.title)}</title>
<style>
:root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #0d1014; color: #e6edf3; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
main { width: min(720px, 100%); border: 1px solid #2c333a; border-radius: 16px; background: linear-gradient(145deg, #121820, #0f1318); padding: 24px; box-shadow: 0 18px 60px rgba(0, 0, 0, 0.32); }
p { margin: 0; color: #9aa8b6; line-height: 1.5; }
h1 { margin: 0 0 8px; font-size: 20px; line-height: 1.2; }
dl { display: grid; grid-template-columns: minmax(120px, 0.35fr) 1fr; gap: 10px 16px; margin: 20px 0 0; }
dt { color: #7f8b99; font-size: 12px; }
dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: #d6dee7; font-size: 12px; }
.badge { display: inline-flex; border: 1px solid #5c6f80; border-radius: 999px; padding: 3px 8px; color: #d8bd70; font-size: 11px; letter-spacing: 0.02em; text-transform: uppercase; }
</style>
</head>
<body>
<main aria-label="Sandboxed extension route host">
<span class="badge">Sandboxed iframe host</span>
<h1>${escapeHtml(entry.title)}</h1>
<p>This controlled route is mounted inside an isolated extension frame. The frame receives only route metadata and does not receive the OpenWaggle preload API.</p>
<dl>
<dt>Extension</dt><dd>${escapeHtml(entry.extensionName)} (${escapeHtml(entry.extensionId)})</dd>
<dt>Contribution</dt><dd>${escapeHtml(entry.contributionId)}</dd>
<dt>Lane</dt><dd>${escapeHtml(contribution.lane)}</dd>
<dt>Entry</dt><dd>${escapeHtml(contribution.entryPath)}</dd>
</dl>
<script type="application/json" id="openwaggle-extension-route-context">${escapeScriptJson(contextJson)}</script>
</main>
</body>
</html>`
}

export function ExtensionSandboxFrame({
  contribution,
}: {
  readonly contribution: ResolvedExtensionRouteContribution
}) {
  return (
    <iframe
      className="min-h-[420px] w-full rounded-xl border border-border bg-[#0d1014]"
      referrerPolicy="no-referrer"
      sandbox={EXTENSION_ROUTE_IFRAME_SANDBOX}
      srcDoc={createExtensionRouteSrcDoc(contribution)}
      title={`Extension route: ${contribution.entry.title}`}
    />
  )
}
