---
title: "Install extensions"
description: "Install a local extension, review its permissions, and enable or remove it in Settings."
order: 6
section: "Customize"
kind: "guide"
---

An extension adds features to OpenWaggle, such as a settings page, a side panel, commands, or tools for the agent. Unlike a [skill](/docs/extending/skills-system), which is only instructions, an extension runs code on your computer. Install extensions only from a source you trust.

You install and manage extensions in **Settings > Extensions**. OpenWaggle installs local packages only. There is no public marketplace and no way to search for extensions online.

## Install a package in one project

Put the whole extension directory in the project:

```text
<project>/.openwaggle/extensions/<extension-id>/
```

The directory must contain `openwaggle.extension.json`, and the directory name must match the `id` in that manifest. Keep the package's source and built files together, as the author ships them. Follow the author's installation instructions instead of copying a single JavaScript file.

A project package affects only that project. Global packages live in the `extensions/` directory of OpenWaggle's app data and can affect every project where they are enabled. Install a global package through OpenWaggle's package workflow, and choose a project package when you only need the extension in one repository.

## Review and enable a package

OpenWaggle finds the package, but does not run any of its code until you trust and enable it.

1. Open **Settings > Extensions** and click **Refresh**.
2. Find the package. Check its path and scope, and read any diagnostics.
3. Review what it asks for: capabilities, network origins, runtime requirements, and any local code it trusts. Check that its SDK range includes your version of OpenWaggle.
4. If it needs a local build, read the build command first. A build runs code on your computer. Choose **Approve and build** to run it. Approving the build does not trust the package.
5. Choose **Trust**, then **Enable**, then **Reload**.
6. Open what the extension adds, such as its settings section or side panel.

**Enable** stays unavailable until you trust the package, and **Reload** appears once it is enabled. This is a package just found in a project, before review:

![The GitHub Issues Overview package in Settings > Extensions, Untrusted and Disabled, with three requirements marked Needs consent and a Trust button](/screenshots/extensions-review.png)

If **Enable** stays unavailable after you trust the package, point at it to see why: missing or invalid files, an SDK range that does not include your version, a build that is not approved or that failed, or error diagnostics. Fix the problem it names. Reloading again does not help.

An enabled package's settings sections appear at the top of **Settings > Extensions**, under **Extension settings**. Each one runs in its own frame.

![Extension settings in Settings > Extensions, showing the GitHub Issues Settings form with repository owner, repository name, and tracked labels](/screenshots/extensions-settings-section.png)

To see where an extension's side panels, transcript cards, and status widgets appear, see [Build an extension](/docs/extending/openwaggle-extensions#contribution-surfaces-at-a-glance).

## Update a package

Trust covers the exact contents you reviewed. When the package's files change, OpenWaggle shows **Update available** and the new version needs your approval. Review the changed package, approve its build if it needs one, and choose **Approve update**. Then enable and reload it if needed.

## Turn off or remove a package

Choose **Disable** to stop everything the package adds without deleting it. For a global package, use **Disable for project** under **Project availability** to turn it off in one project only.

Choose **Remove** and confirm to uninstall the package. OpenWaggle takes its features out of the app first, then deletes the package. Removing a global package asks for a second confirmation, because it affects other projects. Data the extension stored is kept, unless OpenWaggle offers a separate option to delete it.

If an agent helps you create, update, or remove a package, review the change it proposes and its scope before you approve. Ask the agent to use OpenWaggle's package workflow instead of deleting an installed directory itself.

## Build your own extension

See [Build an extension](/docs/extending/openwaggle-extensions) for the manifest, SDK, permissions, and build requirements. To change the agent's tools or runtime behaviour, see [Pi extensions](/docs/extending/pi-extensions).
