---
name: version-bump
description: Classifies a release diff as a major, minor, or patch SemVer change. Use only when the release tool supplies a repository evidence bundle.
disable-model-invocation: true
---

# Classify a SemVer change

Classify the supplied release evidence. Evaluate observable compatibility and capability changes instead of trusting commit prefixes alone.

## Classification rules

- Return `major` when callers must change existing valid usage. Examples include removing or renaming a public interface, rejecting previously valid input, changing a persisted format incompatibly, or changing documented behavior incompatibly.
- Return `minor` when the release adds a backward-compatible capability. Examples include a new command, option, skill, public field, or supported input.
- Return `patch` when the release preserves the public interface. Examples include fixes, documentation, refactoring, tests, build changes, and generated-content updates.
- A breaking-change declaration in a commit requires `major` unless the supplied diff proves that the declaration does not describe the released change.
- A feature declaration requires at least `minor` unless the supplied diff proves that no user-facing capability was added.
- When evidence supports multiple levels, return the highest level.
- Classify only the supplied evidence. Do not assume unlisted changes.

The repository examples in the evidence bundle are authoritative examples for that repository. Apply their demonstrated distinctions when they match the current change. Do not copy an example's result when its facts differ.

## Response

Return one JSON object and no other text. Use exactly these keys:

```json
{
  "bump": "major",
  "rationale": "One concise explanation tied to the supplied evidence.",
  "evidence": ["A commit, path, or diff fact that supports the classification."]
}
```

`bump` must be `major`, `minor`, or `patch`. `rationale` must be non-empty. `evidence` must contain at least one non-empty string.
