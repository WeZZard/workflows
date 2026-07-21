import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVersionBumpExamples } from "../src/examples.mjs";
import {
  detectManifest,
  readManifestVersion,
  writeManifestVersion,
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
