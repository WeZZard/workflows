import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitClient } from "../src/git.mjs";
import { runProcess } from "../src/process.mjs";

function git(cwd, args) {
  return runProcess("git", args, { cwd }).stdout;
}

test("collects complete release evidence from a local Git repository", () => {
  const root = mkdtempSync(join(tmpdir(), "wezzard-release-git-"));
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Release Test"]);
  git(root, ["config", "user.email", "release-test@example.invalid"]);
  writeFileSync(join(root, "README.md"), "before\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "--message", "initial"]);
  git(root, ["tag", "v1.0.0"]);
  git(root, ["tag", "v9.0.0-rc.1"]);
  writeFileSync(join(root, "README.md"), "after\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "--message", "fix: update documentation"]);

  const client = createGitClient(root);
  assert.equal(client.root(), realpathSync(root));
  assert.equal(client.status(), "");
  assert.equal(client.currentBranch(), "main");
  assert.equal(client.latestStableTag(), "v1.0.0");
  assert.equal(client.evidenceBase(null), "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  assert.equal(client.commitCount("v1.0.0"), 1);
  assert.match(client.commitLog("v1.0.0"), /subject: fix: update documentation/);
  assert.equal(client.changedPaths("v1.0.0"), "M\tREADME.md");
  const diff = client.diff("v1.0.0");
  assert.match(diff, /^diff --git a\/README\.md b\/README\.md/m);
  assert.match(diff, /-before\n\+after/);
});
