# WeZZard/workflows

Shared GitHub Actions workflows and release tooling for WeZZard Claude plugin repos.

## Workflows

| Workflow | Tag | Purpose |
|----------|-----|---------|
| `release-plugin.yml` | `@v1.0.0` | Tag, GitHub Release, dispatch catalog sync |
| `propose-release.yml` | `@v1.0.1` | OpenCode semver + release PR (deterministic fallback) |
| `test-release-plugin.yml` | `@main` | Validate YAML + scripts on PR |

## OpenCode

All LLM tasks run through the **OpenCode CLI** (`opencode run`), not direct provider APIs:

- `scripts/suggest-version.mjs` — semver proposal (`prompts/semver-propose-version.md`)
- Consumers: skills `update-plugin-website.mjs` uses the same pattern locally

Set provider auth via `~/.local/share/opencode/auth.json` or `OPENCODE_AUTH_JSON` in CI.

Optional model override: `OPENCODE_MODEL` (default `deepseek/deepseek-chat`).

## Consumer example

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

## Pin policy

Consumers **must** pin reusable workflows to tagged releases, not `@main`.
