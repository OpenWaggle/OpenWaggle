# Third-party notices

OpenWaggle includes material adapted from the projects below. Each is used under the license
reproduced or linked here, which also ships with the packaged app.

## T3 Code

Source: https://github.com/pingdotgg/t3code

The Session title prompts, the conversation context they are given, the reply sanitizing, and the
title evaluation fixtures are adapted from T3 Code's thread title generation
(`apps/server/src/textGeneration`, `apps/server/scripts/evaluate-thread-titles.ts`).

```text
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## OpenCode

Source: https://github.com/anomalyco/opencode

The rule that a greeting or acknowledgement gets a short title of its own is adapted from
OpenCode's title prompt.

```text
MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Simple Icons

Source: https://github.com/simple-icons/simple-icons

The Model Context Protocol logo on MCP tool rows (`src/renderer/src/shared/ui/icons/McpIcon.tsx`)
comes from Simple Icons, which dedicates its icons to the public domain under CC0 1.0 Universal
(https://creativecommons.org/publicdomain/zero/1.0/). CC0 asks for no notice; this entry records
where the logo came from. The logo remains a mark of the Model Context Protocol project.

## heic-decode and libheif-js

Sources: https://github.com/catdad-experiments/heic-decode and
https://github.com/catdad-experiments/libheif-js

OpenWaggle decodes HEIC and HEIF image attachments with these two packages (ADR 0068), which Pi's
own decoder cannot read: `heic-decode` (`index.js`, `lib.js`) is Kiril Vatev's ISC-licensed
wrapper, and it loads `libheif-js`'s WebAssembly build of libheif, which is LGPL-3.0. Both are
loaded lazily, only when a HEIC arrives, and neither is modified.

The LGPL-3.0 text for `libheif-js` ships unmodified beside the library in the packaged app as
`libheif-js/LICENSE`, and the ISC notice for `heic-decode` is its package's `license` field; both
packages remain separate, replaceable files next to the app's own code, which is what the LGPL
asks for. The WebAssembly binary itself carries an HEVC decoder, the component `sharp`'s prebuilt
libvips leaves out; that exposure was accepted deliberately for this one capability, and the
reasoning is recorded in ADR 0068.
