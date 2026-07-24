---
name: propose-release
description: Preview or create a SemVer release pull request with the globally installed WeZZard release workflow. Use when the user asks which version to release, asks to bump a plugin or repository version, or asks to open a release pull request.
---

# Propose a release

Use the shared `wezzard-release` command from the target repository. The command gathers the Git evidence, asks its pinned Pi process to classify the change, computes the exact version, updates the version files, and creates the release pull request.

Do not classify the release yourself. Do not edit version files yourself. Do not use a repository-local wrapper or substitute an `npx` command.

## Check the command

Run this before the workflow:

```bash
command -v wezzard-release
```

If the command is missing, stop and report that the global `WeZZard/workflows` shell package must be installed. Do not install it without the user's request.

## Preview

When the user asks which bump or version the repository needs, or asks to preview or classify a release, run:

```bash
wezzard-release propose --dry-run
```

The dry run must not create a branch, commit, push, or pull request.

## Create the release pull request

Run the mutating command only when the user asks to create, open, or submit the release pull request:

```bash
wezzard-release propose
```

The command requires a clean default branch synchronized with its remote. It creates the release branch, version commit, push, and pull request.

Pass `--provider`, `--model`, or `--thinking` only when the user names an override.

## Report

Read the command's JSON result. Report:

- the current and next versions;
- the major, minor, or patch classification;
- the supplied rationale and evidence;
- the Pi provider and model;
- the pull-request URL when the command created one.
