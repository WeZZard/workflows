import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { VERSION_BUMP_SKILL } from "../src/pi.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(path) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
}

function readSkill(path) {
  const contents = readFileSync(join(repositoryRoot, path), "utf8");
  const match = contents.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${path} must start with YAML frontmatter`);
  return parseDocument(match[1]).toJS();
}

test("keeps every distribution manifest at version 2.1.0", () => {
  const packageDocument = readJson("package.json");
  const lockDocument = readJson("package-lock.json");
  const claudeManifest = readJson(".claude-plugin/plugin.json");
  const codexManifest = readJson(".codex-plugin/plugin.json");

  assert.deepEqual(
    [
      packageDocument.version,
      lockDocument.version,
      lockDocument.packages[""].version,
      claudeManifest.version,
      codexManifest.version,
    ],
    ["2.1.0", "2.1.0", "2.1.0", "2.1.0", "2.1.0"],
  );
  assert.equal(codexManifest.skills, "./skills/");
  assert.deepEqual(packageDocument.pi.skills, ["./skills/propose-release"]);
  assert.ok(packageDocument.keywords.includes("pi-package"));
});

test("exposes only propose-release and keeps the classifier internal", () => {
  const publicSkills = readdirSync(join(repositoryRoot, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(publicSkills, ["propose-release"]);
  assert.equal(readSkill("skills/propose-release/SKILL.md").name, "propose-release");
  assert.equal(
    readSkill("internal/skills/version-bump/SKILL.md").name,
    "version-bump",
  );
  assert.equal(existsSync(join(repositoryRoot, "skills/version-bump/SKILL.md")), false);
  assert.equal(
    relative(repositoryRoot, VERSION_BUMP_SKILL),
    "internal/skills/version-bump/SKILL.md",
  );
});

test("packs every runtime and plugin entry point", () => {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
  const paths = new Set(packed[0].files.map(({ path }) => path));

  for (const expected of [
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    "bin/wezzard-release.mjs",
    "internal/skills/version-bump/SKILL.md",
    "skills/propose-release/SKILL.md",
    "src/pi.mjs",
  ]) {
    assert.ok(paths.has(expected), `npm package must include ${expected}`);
  }
});
