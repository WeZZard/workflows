import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { buildClassificationPrompt, chunkDiff, DIFF_CHUNK_BYTES } from "../src/evidence.mjs";

test("chunks a multi-file diff without losing bytes", () => {
  const longAsciiLine = `+${"a".repeat(DIFF_CHUNK_BYTES + 500)}\n`;
  const unicodeLine = `+${"界".repeat(40_000)}\n`;
  const diff = [
    "diff --git a/a.txt b/a.txt\n",
    "--- a/a.txt\n+++ b/a.txt\n",
    "@@ -1 +1 @@\n-old\n+new\n",
    "diff --git a/b.txt b/b.txt\n",
    "--- a/b.txt\n+++ b/b.txt\n",
    "@@ -0,0 +1,2 @@\n",
    longAsciiLine,
    unicodeLine,
  ].join("");

  const chunks = chunkDiff(diff);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.join(""), diff);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= DIFF_CHUNK_BYTES));
});

test("chunks on file and hunk boundaries when possible", () => {
  const diff = [
    "diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b\n",
    "diff --git a/b b/b\n@@ -1 +1 @@\n-c\n+d\n",
  ].join("");
  const chunks = chunkDiff(diff, 50);
  assert.equal(chunks.join(""), diff);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= 50));
  assert.throws(() => chunkDiff(diff, 3), /at least 4 bytes/);
});

test("builds a skill command with sorted examples supplied by the caller", () => {
  const prompt = buildClassificationPrompt({
    currentVersion: "1.2.3",
    baseTag: "v1.2.3",
    commitLog: "subject: feat: add command",
    changedPaths: "M\tsrc/index.mjs",
    examples: [
      { name: "01-patch.md", content: "patch example\n" },
      { name: "02-minor.md", content: "minor example\n" },
    ],
    chunk: "+export function added() {}\n",
    chunkIndex: 0,
    chunkCount: 1,
  });

  assert.ok(prompt.startsWith("/skill:version-bump "));
  assert.ok(prompt.indexOf("01-patch.md") < prompt.indexOf("02-minor.md"));
  assert.match(prompt, /Diff chunk: 1 of 1/);
  assert.match(prompt, /\+export function added/);
});
