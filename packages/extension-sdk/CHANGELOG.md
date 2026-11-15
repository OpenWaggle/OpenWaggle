# Changelog

## [0.3.0](https://github.com/OpenWaggle/OpenWaggle/compare/extension-sdk-v0.2.0...extension-sdk-v0.3.0) (2026-11-14)


### ⚠ BREAKING CHANGES

* **extension-sdk:** The 132 *Schema exports are removed; use the matching type (usually the schema's name without Schema; the package docs list the renamed ones and the schemas with no public type), a validate* helper, or the manifest JSON Schema. The ./broker and ./manifest subpaths are removed; their types are on the root entry. validateExtensionManifest moves to ./validation and returns { success, value } or { success: false, issues } with { path, message } issues instead of { manifest, issues: string[] }. isOpenWaggleExtensionTheme is replaced by validateOpenWaggleExtensionTheme on ./validation, whose value leaves out undeclared top-level fields. ExtensionManifestValidationResult is replaced by ExtensionValidationResult. createExtensionBrokerSdk, createExtensionBrokerSdkFromInvoke, createRuntimeContributionSdk and toInvokeInput move from the root, ./broker and ./runtime entries to ./testing; extension code uses context.sdk. A broker invalid-payload error now lists every issue, not the first one only.

### Features

* **extension-sdk:** publish types and result helpers with an Effect-free runtime ([#461](https://github.com/OpenWaggle/OpenWaggle/issues/461)) ([9bc04f0](https://github.com/OpenWaggle/OpenWaggle/commit/9bc04f0678b4dc544e0cc843ce05e8630d026e95))


### Bug Fixes

* build and test with Bun and enforce the strictest type, lint and test checks ([#453](https://github.com/OpenWaggle/OpenWaggle/issues/453)) ([901f5b0](https://github.com/OpenWaggle/OpenWaggle/commit/901f5b00dff0b1ae23cb2e036dba6dab4146b18c))

## [0.2.0](https://github.com/OpenWaggle/OpenWaggle/compare/extension-sdk-v0.1.1...extension-sdk-v0.2.0) (2026-11-06)


### ⚠ BREAKING CHANGES

* **tokens:** Extension React styles now require the .ow-extension-root host and SDK 0.2 theme variables.

### Features

* add performant syntax-aware document review ([#180](https://github.com/OpenWaggle/OpenWaggle/issues/180)) ([a3b52f1](https://github.com/OpenWaggle/OpenWaggle/commit/a3b52f135cf29b783b8f7b051be131746185d3e0))
* **platform:** upgrade to TypeScript 7 and Pi 0.81 ([#144](https://github.com/OpenWaggle/OpenWaggle/issues/144)) ([c46ad4e](https://github.com/OpenWaggle/OpenWaggle/commit/c46ad4ec3a2b8e51ddd420284b38f14c7ba3fbaf))
* **session:** add complete Session Summary and resource hub ([#179](https://github.com/OpenWaggle/OpenWaggle/issues/179)) ([fe55618](https://github.com/OpenWaggle/OpenWaggle/commit/fe55618176bb1d8b675c5fdc964ccfec8db04573))
* **shell:** unified right panel with a panel rail ([#278](https://github.com/OpenWaggle/OpenWaggle/issues/278)) ([23e85e3](https://github.com/OpenWaggle/OpenWaggle/commit/23e85e34068eafa6d58302e7a8ed7afab939b5e9))
* **tokens:** adopt Tailwind-standard design contract ([#172](https://github.com/OpenWaggle/OpenWaggle/issues/172)) ([5a3b89d](https://github.com/OpenWaggle/OpenWaggle/commit/5a3b89db295d1dd843ce7666abc2086d3e9ea3bb))


### Bug Fixes

* **deps:** update all dependencies and resolve audit vulnerabilities ([#225](https://github.com/OpenWaggle/OpenWaggle/issues/225)) ([7091c0c](https://github.com/OpenWaggle/OpenWaggle/commit/7091c0c26c4f3ac953667bf333d14269c4715b51))
* estimate Usage & Cost from Pi's model catalog, and rewrite the user docs as plain-English guides and reference pages ([#408](https://github.com/OpenWaggle/OpenWaggle/issues/408)) ([81f6319](https://github.com/OpenWaggle/OpenWaggle/commit/81f63196e272bb876eead904c9d4f74947df0216))

## [0.1.1](https://github.com/OpenWaggle/OpenWaggle/compare/extension-sdk-v0.1.0...extension-sdk-v0.1.1) (2026-07-16)


### Bug Fixes

* **packages:** professionalize npm documentation and release automation ([c4cafd1](https://github.com/OpenWaggle/OpenWaggle/commit/c4cafd173694f6d2290c5dfafbdc76eab00c3260))

## 0.1.0 (2026-07-14)


### Features

* implement OpenWaggle extension contribution host ([e813eb0](https://github.com/OpenWaggle/OpenWaggle/commit/e813eb0de79ecc57ce62f2bb52e7237d3715f4fa))
