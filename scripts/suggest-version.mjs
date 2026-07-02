#!/usr/bin/env node

/**
 * Suggest next semver from conventional commits since the latest git tag.
 * Uses OpenCode when available; falls back to deterministic rules.
 *
 * Usage:
 *   node suggest-version.mjs --version-file .claude-plugin/plugin.json
 *   node suggest-version.mjs --dry-run --version 1.0.0
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";
import { isOpenCodeAvailable, runOpenCodePrompt } from "./opencode-run.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEMVER_PROMPT = join(__dirname, "../prompts/semver-propose-version.md");

const { values: args } = parseArgs({
  options: {
    "version-file": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    version: { type: "string" },
  },
});

function readVersionFromFile(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data.version) {
    throw new Error(`Missing version in ${path}`);
  }
  return data.version;
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bump(version, kind) {
  const parts = parseSemver(version);
  if (kind === "major") {
    return `${parts.major + 1}.0.0`;
  }
  if (kind === "minor") {
    return `${parts.major}.${parts.minor + 1}.0`;
  }
  return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
}

function gitLatestTag() {
  try {
    return execSync("git describe --tags --abbrev=0", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  try {
    return execSync(`git log ${range} --pretty=format:%s`, { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function classifyBump(messages) {
  let bump = "patch";
  for (const message of messages) {
    const subject = message.split("\n")[0];
    if (/^[^:!]*![:!]/.test(subject) || /BREAKING CHANGE/i.test(message)) {
      return "major";
    }
    if (/^feat(\(.+\))?!?:/.test(subject)) {
      bump = bump === "patch" ? "minor" : bump;
    }
  }
  return bump;
}

function deterministicSuggest(versionFile) {
  const current = readVersionFromFile(versionFile);
  const tag = gitLatestTag();
  const messages = commitsSince(tag);
  const bumpKind = messages.length === 0 ? "patch" : classifyBump(messages);
  const next = bump(current, bumpKind);
  return {
    current,
    next,
    bump: bumpKind,
    sinceTag: tag,
    commits: messages.length,
    source: "deterministic",
  };
}

function opencodeSuggest(versionFile) {
  const tag = gitLatestTag();
  const messages = commitsSince(tag);
  const current = readVersionFromFile(versionFile);
  const prompt = [
    "Propose the next semver for this plugin release.",
    "Use the attached semver prompt for rules.",
    `Current version: ${current}`,
    `Latest tag: ${tag ?? "(none)"}`,
    "",
    "Commits since tag:",
    messages.length ? messages.map((m) => `- ${m}`).join("\n") : "- (none)",
    "",
    "Return ONLY JSON: { current, next, bump, rationale }",
  ].join("\n");

  const result = runOpenCodePrompt({
    prompt,
    promptFile: SEMVER_PROMPT,
    files: [versionFile],
  });

  return {
    current: result.current ?? current,
    next: result.next,
    bump: result.bump,
    sinceTag: tag,
    commits: messages.length,
    rationale: result.rationale ?? null,
    source: "opencode",
  };
}

function main() {
  if (args["dry-run"]) {
    const current = args.version ?? "1.0.0";
    const next = bump(current, "patch");
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          current,
          next,
          bump: "patch",
          commits: 0,
          source: "deterministic",
        },
        null,
        2,
      ),
    );
    return;
  }

  const versionFile = args["version-file"];
  if (!versionFile) {
    throw new Error("Missing --version-file");
  }

  if (isOpenCodeAvailable()) {
    try {
      console.log(JSON.stringify(opencodeSuggest(versionFile), null, 2));
      return;
    } catch (error) {
      console.warn(
        `OpenCode semver proposal failed, using deterministic fallback: ${error.message}`,
      );
    }
  }

  console.log(JSON.stringify(deterministicSuggest(versionFile), null, 2));
}

main();
