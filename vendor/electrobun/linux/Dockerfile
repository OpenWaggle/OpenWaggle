# Build environment for the Linux Electrobun native layer (vendor/electrobun/build.ts
# --linux-container). Ubuntu 22.04 is the supported floor: glibc 2.35 and GCC 12's libstdc++
# (GLIBCXX 3.4.30), so everything compiled here loads on it and on every newer distribution.
FROM ubuntu:22.04@sha256:076e7bf82319619f28dd0aa9c02ab34b055ad37100395b4f49a2ffba04fb5e11

ARG DEBIAN_FRONTEND=noninteractive
# Electrobun's Linux dependencies (package/build.ts vendorLinuxDeps), NSS for linking the CEF
# helper against libcef.so, what electrobun-dawn's Dawn build needs (Python, Ninja, X11 headers),
# the GCC 12 toolchain whose libstdc++ Ubuntu 22.04 ships, and the tools build.ts calls.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git xz-utils unzip bzip2 zstd file rsync \
    build-essential gcc-12 g++-12 cmake make pkg-config \
    libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libpipewire-0.3-dev librsvg2-dev \
    libx11-dev libxext-dev libnss3 \
    python3 ninja-build libx11-xcb-dev libxrandr-dev libxinerama-dev libxcursor-dev libxi-dev \
    mesa-common-dev \
  && update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-12 120 \
  && update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-12 120 \
  && update-alternatives --install /usr/bin/cc cc /usr/bin/gcc-12 120 \
  && update-alternatives --install /usr/bin/c++ c++ /usr/bin/g++-12 120 \
  && rm -rf /var/lib/apt/lists/*

# Node runs Electrobun's package-release.js and npm; Bun runs vendor/electrobun/build.ts.
ARG NODE_VERSION=24.14.0
ARG NODE_SHA256=41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df
ARG BUN_VERSION=1.4.4
ARG BUN_SHA256=bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c
RUN curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" \
  && echo "${BUN_SHA256}  /tmp/bun.zip" | sha256sum -c - \
  && unzip -q -j /tmp/bun.zip 'bun-linux-x64/bun' -d /usr/local/bin \
  && chmod 755 /usr/local/bin/bun \
  && rm -f /tmp/node.tar.xz /tmp/bun.zip

# The build runs as the host user (docker run --user), so caches live under a writable HOME.
ENV HOME=/tmp/home
RUN mkdir -p /tmp/home && chmod 1777 /tmp/home
