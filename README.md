# WeZZard/workflows

This repository provides shared local workflows for Claude Code, Codex, Pi, and the shell. The agent plugins expose the workflows; the installed command remains their single implementation. AI credentials remain on the developer's computer.

## Install

Install Node.js 22.19 or newer, authenticate the GitHub CLI, and configure provider authentication once in Pi's global user settings.

Install the command from the pinned Git release:

```bash
npm install --global 'github:WeZZard/workflows#v2.1.0'
```

Then install the agent adapter or adapters you use.

### Claude Code

```bash
claude plugin marketplace add WeZZard/skills
claude plugin marketplace update wezzard-skills
claude plugin install workflows@wezzard-skills --scope user
```

Upgrade an existing installation with:

```bash
claude plugin marketplace update wezzard-skills
claude plugin update workflows@wezzard-skills --scope user
```

### Codex

```bash
codex plugin marketplace add WeZZard/skills --ref main
codex plugin marketplace upgrade wezzard-skills
codex plugin add workflows@wezzard-skills
```

Upgrade the marketplace snapshot and installed plugins with:

```bash
codex plugin marketplace upgrade wezzard-skills
```

### Pi

Pi installs the pinned package straight from its remote Git repository:

```bash
pi install git:github.com/WeZZard/workflows@v2.1.0
```

Run the same command with a later tag to upgrade.

## Local release proposal

Run the command from a clean and synchronized default branch:

```bash
wezzard-release propose
```

The command performs these actions:

1. It finds `.claude-plugin/plugin.json` or `canonical/manifest.json` as the primary version file.
2. It requires any version-bearing `.codex-plugin/plugin.json`, `package.json`, and `package-lock.json` companions to match the primary version.
3. It collects every committed textual diff since the latest stable tag.
4. It splits the diff into lossless 96 KiB chunks.
5. It asks the pinned Pi CLI to classify each chunk as a major, minor, or patch change.
6. It chooses the highest classification and calculates the next version.
7. It updates the synchronized version files.
8. It creates a release branch, commits the version change, pushes the branch, and opens a pull request.

When a stable tag exists, the manifest version must exactly match that tag after removing an optional `v` prefix. This prevents a stale or prematurely edited manifest from becoming the basis for another bump. When no stable tag exists, the manifest's valid SemVer is treated as the unpublished baseline, the full repository history is classified, and one bump is proposed from that baseline.

If manifest editing, staging validation, commit, push, or pull-request creation fails after the release branch is created, the command returns to the default branch with a clean tree and removes the local release branch. It also removes the remote release branch when this invocation created it; guarded Git leases prevent overwriting or deleting a branch that appeared or changed concurrently.

Pi uses the authentication and default model stored in the user's global Pi configuration. The command disables tools, context files, prompt templates, discovered skills, and extensions. It loads only `internal/skills/version-bump/SKILL.md`.

The command records the provider and model reported by Pi in its JSON result and pull request. It records an explicit thinking override when supplied and otherwise marks the thinking level as inherited.

Repository-specific examples may be stored as Markdown files in `.agents/examples/version-bump/`. The command loads them in filename order.

Use `--dry-run` to classify the release without creating a branch, commit, push, or pull request:

```bash
wezzard-release propose --dry-run
```

Use command-line overrides when the global Pi selection is not appropriate:

```bash
wezzard-release propose \
  --provider deepseek \
  --model deepseek-v4-pro \
  --thinking high
```

Pass `--version-file path/to/manifest.json` to update only that file when a repository intentionally keeps other version-bearing files independent.

## Reusable release workflow

`release-plugin.yml` creates the tag and GitHub Release after the version pull request merges. It then dispatches deterministic catalog synchronization.

```yaml
jobs:
  release:
    uses: WeZZard/workflows/.github/workflows/release-plugin.yml@v1.0.0
    with:
      plugin_name: amplify
      version_file: .claude-plugin/plugin.json
      release_title_prefix: Amplify
      source_repo: WeZZard/amplify
      event_name: ${{ github.event_name }}
      dispatch_tag: ${{ github.event.inputs.tag }}
      dispatch_version: ${{ github.event.inputs.version }}
    secrets:
      RELEASE_TOKEN: ${{ secrets.AMPLIFY_RELEASE_TOKEN }}
```

Consumers must pin reusable workflows and the local package to release tags instead of `main`.
