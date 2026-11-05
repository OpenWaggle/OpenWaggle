---
title: "Pull and merge requests"
description: "Open a pull or merge request from a session, check its status and merge it, and set up GitHub or GitLab hosts and accounts."
order: 4
section: "Using OpenWaggle"
kind: "guide"
---

OpenWaggle can open a GitHub pull request or a GitLab merge request for a session's branch, show its checks and reviews, and merge it, without leaving the app. It does this through the `gh` or `glab` command-line tool, so you need the right one installed and signed in to the remote's host. Start from the **Environment** section of the [Session Summary](/docs/using-openwaggle/session-summary).

## Create a request

1. Open the Session Summary and choose **Create PR** for GitHub or **Create MR** for GitLab.
2. Check the source and target branches. If you are on the default branch, check the feature branch name OpenWaggle proposes.
3. Edit the title and description. The title starts as the session's title.
4. If local changes should go into the request, check **Commit and push local changes**.
5. Choose **Create PR** or **Create draft PR** (**MR** on GitLab). `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux runs **Create PR**.

Before it creates a branch, commits or pushes anything, OpenWaggle checks that `gh` or `glab` can reach the remote's host. If it cannot, the panel says why and turns those actions off.

If you leave the description empty, OpenWaggle writes a short summary, with the changed-file totals when local changes will be committed. Once the request exists, the row reads **View PR** or **View MR**, and the request appears under the session's outputs.

**Open PR in browser** (**Open MR in browser**) is there when the remote supports it, as a way around the CLI. It opens the provider's new-request page with the branch, target, title and description filled in. It does not commit, push or create anything in OpenWaggle.

If the provider creates the request but OpenWaggle cannot add it to the session's outputs, keep the panel open and choose **Retry adding PR to Outputs**. That records the request that already exists; it does not create a second one. If you close the panel instead, the request is still fine at the provider, but it may be missing from this session's outputs.

## Check and merge a request

**View PR** opens the request inspector in the right sidebar. It shows the title, a link to the provider, the base and head branches, whether the request is open, draft or merged, the changed-file totals, and a link to the branch diff. When `gh` or `glab` reports them, it also shows checks, reviews, whether the request can merge, and comment counts. It does not refresh by itself; refresh it when you want the latest state. If the session created several requests, you can switch between them here.

**Open on GitHub** or **Open on GitLab** opens the request on the provider's site. When the provider says the request can merge, the inspector offers merge, squash or rebase. OpenWaggle asks you to confirm, checks the request and its head commit again, and then runs the merge through the CLI. A disabled merge says what blocks it, such as failing checks, missing reviews, conflicts, draft status or a provider rule.

The inspector names the account that read the request, for example **via @jdoe_acme**.

## Choose where requests open

By default, **View PR** opens the inspector. The icon at the end of the row opens the request on the provider's site instead, and so does `Cmd`-click on macOS or `Ctrl`-click on Windows and Linux.

To open requests on the provider's site by default, go to **Settings > Connections > Source control** and set **Open pull and merge requests in** to **Provider website**. The row then swaps the two: a click opens the site, and the icon or a modified click opens the inspector. The site opens wherever **Open web links in** sends web links.

A project can set its own default in its settings file, shown [below](#share-host-settings-with-a-project). Your choice in Settings wins over the project's. You can also ask the agent to change either one.

## Fix a request that cannot load

When OpenWaggle cannot read a request, the row and the inspector say what is missing and offer one fix. The provider's site stays one click away in every case.

| Problem | What OpenWaggle offers |
| --- | --- |
| CLI not installed | The install command for `gh` or `glab`. OpenWaggle checks again when the window gets focus back. |
| Not signed in | **Sign in to** and the host name, which runs `gh auth login --hostname` with that host (or the `glab` equivalent) in a new terminal tab of the session. |
| No account can see the repository | The accounts it tried, and **Sign in with another account** to add one to the CLI. |
| Unknown host | A one-time question: is the host GitHub, GitLab, or **Neither**? Choose **Neither** for another forge and OpenWaggle stops asking. |

The sign-in terminal tab clears `GH_TOKEN`, `GITHUB_TOKEN` and `GITLAB_TOKEN`, because the CLI refuses to sign in while they are set. The CLI handles single sign-on in your browser. OpenWaggle always uses the CLI's stored sign-in and ignores those token variables.

## How OpenWaggle recognizes a host

OpenWaggle works with github.com, gitlab.com, GitHub Enterprise Server and self-hosted GitLab. In most cases it works out which provider a remote belongs to without any setup. It checks, in this order:

1. Your own choice for the host.
2. A choice the project declares, once you approve it.
3. github.com, gitlab.com, and GitHub Enterprise Cloud hosts (`*.ghe.com`).
4. Hosts you are signed in to with `gh` or `glab`.
5. A `gh` or `glab` Git credential helper for the host, or a repository path deeper than *owner/repository*, which only GitLab allows.
6. A host name that contains `github` or `gitlab`.
7. The request refs the remote advertises (`refs/pull/*` or `refs/merge-requests/*`). OpenWaggle remembers the answer for the host.

If none of these answers, the Session Summary asks you once. Bitbucket, Azure DevOps, Codeberg and gitea.com remotes, and Azure DevOps or Bitbucket Server repository paths, count as other forges and are never asked about, unless a check higher in the list says otherwise. A self-hosted Gitea or Forgejo server advertises the same refs as GitHub, so OpenWaggle may take it for GitHub; set it to **Neither** in Settings.

OpenWaggle resolves SSH host aliases from `~/.ssh/config` to the real host first, and `glab`'s `ssh_host` setting maps an SSH host back to its GitLab instance. It never contacts the API of a server you have not confirmed just to identify it.

**Settings > Connections > Source control** lists every host OpenWaggle knows, including hosts from project settings you approved, how it decided each host's provider, and the accounts the CLI holds. There you can change a host's provider, mark it as **Neither**, add a host before you clone from it, or forget a provider you chose or OpenWaggle detected.

## Use several accounts on one host

If `gh` holds more than one account for a host, for example a personal account and a GitHub Enterprise Cloud account on github.com, OpenWaggle first tries the account it remembered for the repository, then the active account. When that account cannot see the repository, it tries the others, each with its own stored token, for that one command. When an account other than the active one works, OpenWaggle remembers it for the repository.

Creating, merging and checking out a request never switch accounts. They run once, as the account that last read the repository, and the merge confirmation names it. OpenWaggle never runs `gh auth switch`, so the active account in your own terminal stays the same.

## Work from a fork

When your branch lives on a fork, OpenWaggle also looks for its request in the repository the fork came from and in a remote named `upstream`. It remembers the repository it finds.

## Share host settings with a project

A project can declare its hosts, and where its requests open, in `.openwaggle/settings.json`:

```json
{
  "sourceControl": {
    "hosts": { "git.acme.io": "gitlab" },
    "changeRequestOpenDestination": "website"
  }
}
```

The first time a project declares hosts, the Session Summary asks you to approve them, and they change nothing until you do. Each host is approved on its own: a host you approved stays approved when the project adds another, and only a new or changed host asks again. Accounts are never stored in project files.

These settings belong to the project, not to one session. OpenWaggle stores them for the repository's main checkout, so they apply to every session of the project, new worktrees included. A host the agent declares from a worktree session applies to the whole project at once. A shared open setting written in a worktree takes effect once that change reaches the main checkout.

You can also tell the agent, for example "our GitLab is git.acme.io and open merge requests on the website". Its `source_control` tool reads the current setup and changes it after you approve. Signing in is always your step.

## If you cannot create a request

- Check that the remote is on GitHub or GitLab and that `gh` or `glab` is signed in to that host. **Settings > Connections > Source control** shows which provider OpenWaggle chose for the host and why.
- On a detached `HEAD`, create or check out a branch first.
- A new feature branch needs at least one commit, or local changes selected under **Commit and push local changes**.
