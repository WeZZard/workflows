import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVersionBumpExamples } from "../src/examples.mjs";
import {
  detectManifest,
  detectVersionSet,
  readManifestVersion,
  writeManifestVersion,
  writeVersionSet,
} from "../src/manifest.mjs";

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "wezzard-release-test-"));
}

test("auto-detects one manifest and accepts an explicit in-repository file", () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin/plugin.json"), '{"version":"1.0.0"}\n');
  assert.equal(detectManifest(root).relativePath, ".claude-plugin/plugin.json");

  writeFileSync(join(root, "other.json"), '{"version":"1.0.0"}\n');
  assert.equal(detectManifest(root, "other.json").relativePath, "other.json");
  assert.throws(() => detectManifest(root, "../outside.json"), /inside the repository/);
});

test("rejects missing and ambiguous auto-detection", () => {
  const root = temporaryDirectory();
  assert.throws(() => detectManifest(root), /Could not find/);
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "canonical"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin/plugin.json"), '{"version":"1.0.0"}\n');
  writeFileSync(join(root, "canonical/manifest.json"), '{"version":"1.0.0"}\n');
  assert.throws(() => detectManifest(root), /multiple version files/);
});

test("updates only the textual version value", () => {
  const root = temporaryDirectory();
  const path = join(root, "manifest.json");
  const original = '{\n  "name": "demo",\n  "version": "1.2.3",\n  "value": 7\n}\n';
  writeFileSync(path, original);
  writeManifestVersion(path, "1.2.3", "1.3.0");
  assert.equal(
    readFileSync(path, "utf8"),
    original.replace('"1.2.3"', '"1.3.0"'),
  );
  assert.equal(readManifestVersion(path), "1.3.0");
});

test("discovers and updates the synchronized version-file set", () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  const originals = new Map([
    [
      ".claude-plugin/plugin.json",
      '{\n  "name": "demo",\n  "version": "1.2.3",\n  "value": "claude"\n}\n',
    ],
    [
      ".codex-plugin/plugin.json",
      '{\n  "name": "demo",\n  "version": "1.2.3",\n  "value": "codex"\n}\n',
    ],
    [
      "package.json",
      '{\n  "name": "demo",\n  "version": "1.2.3",\n  "value": "package"\n}\n',
    ],
    [
      "package-lock.json",
      '{\n  "name": "demo",\n  "version": "1.2.3",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "demo",\n      "version": "1.2.3",\n      "license": "MIT"\n    }\n  }\n}\n',
    ],
  ]);
  for (const [path, contents] of originals) {
    writeFileSync(join(root, path), contents);
  }

  const versionSet = detectVersionSet(root);
  assert.equal(versionSet.current, "1.2.3");
  assert.equal(versionSet.primary.relativePath, ".claude-plugin/plugin.json");
  assert.deepEqual(
    versionSet.files.map(({ relativePath }) => relativePath),
    [
      ".claude-plugin/plugin.json",
      ".codex-plugin/plugin.json",
      "package.json",
      "package-lock.json",
    ],
  );

  writeVersionSet(versionSet, "1.2.3", "1.3.0");
  for (const [path, original] of originals) {
    assert.equal(
      readFileSync(join(root, path), "utf8"),
      original.replaceAll('"1.2.3"', '"1.3.0"'),
    );
  }
});

test("rejects mismatched companion versions before release work begins", async (t) => {
  const cases = [
    [".codex-plugin/plugin.json", '{"version":"1.2.2"}\n', /plugin\.json=1\.2\.2/],
    ["package.json", '{"version":"2.0.0"}\n', /package\.json=2\.0\.0/],
    [
      "package-lock.json",
      '{"version":"1.2.2","packages":{"":{"version":"1.2.2"}}}\n',
      /package-lock\.json=1\.2\.2/,
    ],
  ];
  for (const [path, contents, message] of cases) {
    await t.test(path, () => {
      const root = temporaryDirectory();
      mkdirSync(join(root, ".claude-plugin"), { recursive: true });
      mkdirSync(join(root, ".codex-plugin"), { recursive: true });
      writeFileSync(join(root, ".claude-plugin/plugin.json"), '{"version":"1.2.3"}\n');
      writeFileSync(join(root, path), contents);
      assert.throws(() => detectVersionSet(root), message);
    });
  }
});

test("rejects a package lock whose two root versions disagree", () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin/plugin.json"), '{"version":"1.2.3"}\n');
  writeFileSync(
    join(root, "package-lock.json"),
    '{"version":"1.2.3","packages":{"":{"version":"1.2.2"}}}\n',
  );
  assert.throws(() => detectVersionSet(root), /Package lock versions disagree/);
});

test("skips a package without a version and keeps explicit version files isolated", () => {
  const root = temporaryDirectory();
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin/plugin.json"), '{"version":"1.2.3"}\n');
  writeFileSync(join(root, ".codex-plugin/plugin.json"), '{"version":"9.0.0"}\n');
  writeFileSync(join(root, "package.json"), '{"name":"demo"}\n');
  writeFileSync(
    join(root, "package-lock.json"),
    '{"name":"demo","lockfileVersion":3,"packages":{"":{"name":"demo"}}}\n',
  );

  const explicit = detectVersionSet(root, ".claude-plugin/plugin.json");
  assert.deepEqual(
    explicit.files.map(({ relativePath }) => relativePath),
    [".claude-plugin/plugin.json"],
  );

  writeFileSync(join(root, ".codex-plugin/plugin.json"), '{"version":"1.2.3"}\n');
  const automatic = detectVersionSet(root);
  assert.deepEqual(
    automatic.files.map(({ relativePath }) => relativePath),
    [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"],
  );
});

test("loads only Markdown examples in code-point filename order", () => {
  const root = temporaryDirectory();
  const directory = join(root, ".agents/examples/version-bump");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "20-minor.md"), "minor");
  writeFileSync(join(directory, "10-patch.md"), "patch");
  writeFileSync(join(directory, "notes.txt"), "ignored");
  assert.deepEqual(loadVersionBumpExamples(root), [
    { name: "10-patch.md", content: "patch" },
    { name: "20-minor.md", content: "minor" },
  ]);
  assert.deepEqual(loadVersionBumpExamples(temporaryDirectory()), []);
});
