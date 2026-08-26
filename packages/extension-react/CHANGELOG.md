# Changelog

## [0.2.0](https://github.com/OpenWaggle/OpenWaggle/compare/extension-react-v0.1.1...extension-react-v0.2.0) (2026-08-26)


### ⚠ BREAKING CHANGES

* **packages:** replace the 0.1 stylesheet variables with the ADR 0024 Tailwind-standard SDK contract. Extension surfaces must mount beneath `.ow-extension-root`; the OpenWaggle host applies this class automatically.


### Features

* **packages:** align React primitives with the SDK 0.2 colour, typography, spacing, radius, shadow, and focus tokens


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openwaggle/extension-sdk bumped to 0.2.0

## [0.1.1](https://github.com/OpenWaggle/OpenWaggle/compare/extension-react-v0.1.0...extension-react-v0.1.1) (2026-07-16)


### Bug Fixes

* **packages:** professionalize npm documentation and release automation ([c4cafd1](https://github.com/OpenWaggle/OpenWaggle/commit/c4cafd173694f6d2290c5dfafbdc76eab00c3260))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openwaggle/extension-sdk bumped to 0.1.1

## 0.1.0 (2026-07-14)


### Features

* implement OpenWaggle extension contribution host ([e813eb0](https://github.com/OpenWaggle/OpenWaggle/commit/e813eb0de79ecc57ce62f2bb52e7237d3715f4fa))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @openwaggle/extension-sdk bumped to 0.1.0
