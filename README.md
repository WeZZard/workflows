# WeZZard/workflows

Shared GitHub Actions workflows and release tooling for WeZZard Claude plugin repos.

## Workflows

| Workflow | Tag | Purpose |
|----------|-----|---------|
| `release-plugin.yml` | `@v1.0.0` | Tag, GitHub Release, dispatch catalog sync |
| `propose-release.yml` | `@v1.0.0` | Conventional-commit semver bump + release PR |
| `test-release-plugin.yml` | `@main` | Validate YAML + scripts on PR |

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

## Scripts

- `scripts/suggest-version.mjs` — deterministic semver from conventional commits (OpenCode prompt in `prompts/` is optional)

## Pin policy

Consumers **must** pin reusable workflows to tagged releases (`@v1.0.0`), not `@main`.
