---
title: "Installation"
description: "How to install OpenWaggle on macOS, Windows, or Linux."
order: 2
section: "Getting started"
kind: "guide"
---

Install OpenWaggle from a download on [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases), or with a one-line script on macOS and Linux. Each release lists its platforms, and GitHub marks prereleases. You don't need Node.js or a copy of the source code to run the app.

Released builds send anonymous usage statistics and error reports from the first launch. They never include prompts, code, file paths, or anything that identifies you or your install. [Usage statistics fields](/docs/reference/usage-statistics-fields) lists every field, and [Usage statistics and error reports](/docs/configuration/usage-statistics) shows how to turn them off.

## System requirements

| Platform | Minimum | Architectures |
|----------|---------|---------------|
| macOS | macOS 13.4 (Ventura) | Apple silicon and Intel |
| Windows | Windows 10 | x64 |
| Linux | glibc 2.35, for example Ubuntu 22.04, Debian 12 or Fedora 36 | x64. The AppImage is x64 only. |

To check your glibc version on Linux, run:

```bash
ldd --version
```

OpenWaggle still opens and keeps updating on macOS 12 through 13.3, but those versions are not supported. Semantic session search and voice input need macOS 13.4 and fail on older versions.

You also need access to an AI provider, through an API key, a sign-in or another supported setup (see [Providers and models](/docs/providers/overview)), and an internet connection when you use hosted models.

## Install from a download

Download the file for your platform from [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases) and install it:

| Platform | File | How to install |
|----------|------|----------------|
| macOS | `.dmg` | Choose Apple silicon or Intel, open the disk image, and drag OpenWaggle to Applications. |
| Windows | `.exe` | Run the installer and follow its prompts. |
| Linux | `.AppImage` | Make the file executable, then open it. |

Then follow [Get started](/docs/getting-started/first-run) to connect a model and open a project.

### Open the app for the first time

macOS builds are signed with an Apple Developer ID and notarized by Apple, so macOS doesn't block them as coming from an unidentified developer. The first time you open one, macOS may still ask you to confirm that you want to open an app from the internet.

Builds before `1.0.0-beta.1` were unsigned, and an in-app update from one of them may not install. If you still run one, download the current version from GitHub Releases once and replace the app in Applications.

Windows installers are not signed yet, so SmartScreen may warn you the first time you run one. Check that you downloaded it from the official release page, then choose **More info** and **Run anyway**. The Linux AppImage is not signed either.

## Install from the terminal

On macOS and Linux, this command downloads the install script and runs it:

```bash
{{install-command}}
```

To read the script before you run it, open [{{install-script-raw-url}}]({{install-script-raw-url}}). That address works in place of `{{install-url}}` in every command on this page.

On a first install, the script installs the newest release on the **Stable** channel and saves Stable as your update channel. Until the first Stable release is out, it uses **Beta** instead, which also gets release candidates and, later, Stable releases. To start on another channel, see [Install a prerelease channel](#install-a-prerelease-channel).

If the release has a `SHA256SUMS` file with an entry for the download, the script checks the download's SHA-256 checksum and stops if it doesn't match. A release without that file or entry installs without the check.

Where it installs depends on the platform:

- On macOS, it copies `OpenWaggle.app` to `/Applications`, removes its quarantine attribute, and puts the `openwaggle` command in `~/.local/bin`.
- On Linux, it puts the AppImage in `~/.local/lib/openwaggle`, the `openwaggle` command in `~/.local/bin`, and a `.desktop` entry for your desktop's app menu.

When it finishes, the script opens OpenWaggle. It doesn't open the app over SSH, in CI, or on Linux without a display.

### Update an existing install

Run the same command again to update. The script asks the installed OpenWaggle which update channel it uses and installs the newest release on that channel, so a re-run keeps your channel and doesn't save a new one. Asking may start the installed version's Session Host, which the script stops anyway before it replaces the app. Set `OPENWAGGLE_CHANNEL` to switch channel.

Versions up to `1.0.0-beta.37` can't report their channel. If you have one of those, or the installed app doesn't answer within 60 seconds, the script says so, uses the first-install default and saves it. To stay on another channel, such as Alpha, set `OPENWAGGLE_CHANNEL` that one time. If your channel has no release yet, as Stable before `1.0.0`, the script says OpenWaggle is up to date and changes nothing.

The script never installs a version older than the one you have, because an older version may not be able to open data a newer one has already updated. If the newest release on the channel is older, it stops with status 2 before it downloads anything, and the installed app keeps running. The version you already have reinstalls.

Before it replaces the app, the script stops OpenWaggle's background Session Host, the same way **Restart to update** does. If an agent is still working, it asks whether to wait for the work, stop it, or cancel. If you cancel, or press Ctrl-C while it waits, the installed version stays as it was and the script reopens the app if it had quit it. If the installed version is too old to ask, the script tells its Session Host to stop, waits up to 20 seconds for running work, then installs even if that work is still finishing. A version without the `host` command is not stopped, so run `openwaggle host stop --update` after the install.

On macOS, if the copy being replaced is open, the script quits it and opens the new version. A copy opened from somewhere else stays open. All installed copies share one Session Host, so if another copy is open when the script updates an existing install, the script stops and asks you to quit that copy first.

On Linux, an open OpenWaggle keeps running with its Session Host. To use the new version, quit the app, run this command, then open the app again:

```bash
openwaggle host stop --update
```

### Install without opening the app

Pass `--no-launch`, or set `OPENWAGGLE_NO_LAUNCH=1`, to install without opening OpenWaggle:

```bash
curl -fsSL {{install-url}} | bash -s -- --no-launch
```

[Environment variables](/docs/reference/environment-variables#install-script) lists every variable the script reads.

### Install a prerelease channel

To use the Beta channel, which also gets release candidates and Stable releases, run:

```bash
curl -fsSL {{install-url}} | OPENWAGGLE_CHANNEL=beta bash
```

To use the Alpha channel, which also gets Beta, release candidate and Stable releases, run:

```bash
curl -fsSL {{install-url}} | OPENWAGGLE_CHANNEL=alpha bash
```

The script saves the channel you chose, not the label of the file it downloaded. An Alpha install stays on Alpha even when the newest release it can get happens to be a Beta or Stable build. Later re-runs keep that channel without `OPENWAGGLE_CHANNEL`. Setting it is the only way the script changes your channel, the same as `openwaggle update --channel`.

### Install one exact version

Set `OPENWAGGLE_RELEASE_TAG` to install one version without changing your saved channel. Tags look like `v1.0.0`, `v1.0.0-rc.1` or `v1.0.0-beta.25`. Replace `v1.0.0` below with a tag listed on [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases):

```bash
curl -fsSL {{install-url}} | OPENWAGGLE_RELEASE_TAG=v1.0.0 bash
```

OpenWaggle doesn't support downgrades, so the script refuses a version older than the one installed. It exits with status 2 before it changes anything, as `openwaggle update --version` does. The version you already have reinstalls.

## Use the openwaggle command

On macOS and Linux, opening the app installs the `openwaggle` command in `~/.local/bin`, or refreshes it after an update. Make sure `~/.local/bin` is on your shell's `PATH`. OpenWaggle never replaces a different program that is already at that path. On Windows, the installer adds the command for you.

The command lets terminals and other coding agents run agents without the window and control the same sessions you see in the app. To list its commands, run:

```bash
openwaggle --help
```

See [Command line](/docs/developer-workflow/command-line) and [Hive CLI](/docs/developer-workflow/hive-cli).

## Change the update channel

The app and the `openwaggle` command share one saved update channel: `stable`, `beta` or `alpha`. Release candidates are not a channel of their own. Beta and Alpha get them.

In the app, open **Settings > General > About & Updates**. The app asks you to confirm a switch to Alpha, and checks the new channel right away.

From a terminal, check what is available without downloading anything or changing a setting:

```bash
openwaggle update --check
```

Add `--json` to `--check` to get the result as JSON, including the saved channel in `savedChannel`. If the check itself fails, the error is JSON too, and still includes `savedChannel` once OpenWaggle has read it.

To switch channel and install its newest release, run this with `alpha`, `beta` or `stable`. Add `--check` to look at a channel without saving it.

```bash
openwaggle update --channel beta
```

To install one exact Stable or prerelease version, replace `1.0.0` with a version listed on [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases). It doesn't change your saved channel.

```bash
openwaggle update --version 1.0.0
```

Without `--check`, `openwaggle update` downloads and installs the newest release you can get, without opening the app:

- If OpenWaggle is open, the command leaves the update to the app. Open **Settings > General > About & Updates**, choose **Check now**, then **Restart to update**, so the app can ask before stopping an agent's work.
- `--version` asks you to quit OpenWaggle first. It refuses a version older than the one installed and exits with status 2. The version you already have reinstalls.
- Before it installs, the command stops the Session Host the way **Restart to update** does. If an agent is still working, it asks whether to wait for it, stop it, or cancel. Without a terminal to ask in, as on Windows, it waits for the work to finish.

Until the first Stable release is out, the Stable channel has nothing to install, so the app and `openwaggle update` report it as up to date rather than as a failed check. A release whose update files are still uploading is skipped until a later check.

The first time OpenWaggle starts without a saved channel, an Alpha or Beta build starts on its own channel and a release candidate starts on Beta. Every other build starts on Stable. Changing channel never installs an older version. **Restart to update** reads the saved channel again before it installs a release it already downloaded.

Released builds check for updates a few seconds after they open and then every 4 hours. These checks contact GitHub. See [Update checks](/docs/configuration/usage-statistics#update-checks).

## Build from source

To run a development checkout instead of an installer, see [Building from source](/docs/developer-guide/building-from-source).
