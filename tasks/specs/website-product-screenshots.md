# Spec: Website Product Screenshots

## Goal
Add clean product screenshots to the website landing page, remove the visible TanStack devtools badge from captured app imagery, and place each screenshot in the appropriate marketing section.

## Scope
- Make TanStack devtools opt-in in local development so product screenshots are clean by default.
- Generate four website-ready screenshots:
  - Hero / overview
  - Full coding agent
  - Git-native workflow
  - Extensibility (skills / MCPs)
- Replace landing page placeholders with real screenshot assets.
- Keep current website layout and brand language intact while improving presentation quality.

## Plan
- [x] Add a safe devtools visibility gate so the TanStack badge does not appear by default in dev.
- [x] Create a reproducible screenshot capture flow for the required landing-page assets.
- [x] Save the resulting images under `website/public/screenshots/`.
- [x] Replace hero and feature placeholders with the new assets.
- [x] Verify renderer + website changes (`pnpm check:fast`, website build, React Doctor if renderer touched).

## Review
- TanStack devtools are now hidden by default in local development and can still be re-enabled explicitly through local storage for debugging sessions.
- Added a Playwright-based screenshot capture script that seeds a realistic waggle review thread, restarts the app, and exports four landing-page screenshots to `website/public/screenshots/`.
- Replaced the hero and feature placeholders with the captured assets using a shared `ProductScreenshot` component to keep framing, border, and shadow treatment consistent.
- Shifted the waggle screenshots away from self-referential product copy toward a real "review this fix before merge" thread so the website imagery reflects everyday OpenWaggle usage.
- Kept the built-in terminal in the secondary feature grid as a lighter-weight placeholder instead of promoting it to a full screenshot block.
- Verification passed with `pnpm check:fast`, `pnpm website:build`, `pnpm exec tsx scripts/capture-website-screenshots.ts`, and `pnpm dlx react-doctor@latest . --verbose --diff main`.
