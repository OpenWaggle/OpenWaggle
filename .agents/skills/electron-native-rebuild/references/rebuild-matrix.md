# Electron Native Rebuild Matrix

## Common failures

- `The module ... was compiled against a different Node.js version`
  Meaning: the addon was built for the wrong ABI.
- `dlopen(...): symbol not found`
  Meaning: the binary does not match the Electron runtime on the machine.
- Electron exits before the first window during E2E
  Meaning: check both native rebuilds and the environment forwarded by Playwright.

## Preferred commands

- Node/Vitest path:
  - `pnpm prepare:native:node`
- Electron/dev/build/E2E path:
  - `pnpm prepare:native:electron`

## Manual fallback

If the scripted Electron rebuild is not enough, confirm the installed Electron version and rebuild with:

```bash
npm_config_runtime=electron \
npm_config_target=<installed-electron-version> \
npm_config_disturl=https://electronjs.org/headers \
pnpm rebuild better-sqlite3
```

## Validation checklist

1. `pnpm test`
2. `pnpm build`
3. `pnpm test:e2e:headless:quick`
4. If only E2E still fails, inspect the env allowlist in `e2e/support/openwaggle-app.ts`
