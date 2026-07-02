# Semver propose version (OpenCode)

Analyze commits since the last git tag and the current version in the plugin manifest.

## Inputs

- Git log since latest tag (`git describe --tags --abbrev=0..HEAD`)
- Current `version` from `plugin.json` or `manifest.json`
- Conventional commit subjects

## Task

Propose the next semver (`patch`, `minor`, or `major`) and the bumped version string.

Rules:

- `feat!:` or `BREAKING CHANGE` → **major**
- `feat:` → **minor** (unless major already required)
- otherwise → **patch**

## Output

JSON:

```json
{
  "current": "1.2.63",
  "next": "1.2.64",
  "bump": "patch",
  "rationale": "..."
}
```

Human accepts or overrides before opening the release PR.
