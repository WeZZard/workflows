import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitClient } from "../src/git.mjs";
import { runProcess } from "../src/process.mjs";
import { proposeRelease } from "../src/release.mjs";

function git(cwd, args, acceptedExitCodes = [0]) {
  return runProcess("git", args, { cwd, acceptedExitCodes });
}

test("a pull-request failure restores a real repository and removes only the pushed release branch", () => {
  const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), "wezzard-release-transaction-")));
  const origin = join(fixtureRoot, "origin.git");
  const repository = join(fixtureRoot, "repository");
  mkdirSync(repository);
  git(fixtureRoot, ["init", "--bare", origin]);
  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.name", "Release Test"]);
  git(repository, ["config", "user.email", "release-test@example.invalid"]);
  git(repository, ["config", "commit.gpgsign", "false"]);
  git(repository, ["remote", "add", "origin", origin]);

  mkdirSync(join(repository, ".claude-plugin"));
  const manifest = join(repository, ".claude-plugin/plugin.json");
  const originalManifest = '{\n  "name": "fixture",\n  "version": "1.2.3"\n}\n';
  writeFileSync(manifest, originalManifest);
  writeFileSync(join(repository, "README.md"), "initial\n");
  git(repository, ["add", ".claude-plugin/plugin.json", "README.md"]);
  git(repository, ["commit", "--message", "initial"]);
  git(repository, ["tag", "v1.2.3"]);
  writeFileSync(join(repository, "README.md"), "initial\nnew command\n");
  git(repository, ["add", "README.md"]);
  git(repository, ["commit", "--message", "feat: add command"]);
  git(repository, ["push", "--set-upstream", "origin", "main"]);
  git(repository, ["push", "origin", "v1.2.3"]);
  const originalHead = git(repository, ["rev-parse", "HEAD"]).stdout.trim();

  const github = {
    defaultBranch: () => "main",
    openPullRequests: () => [],
    createPullRequest: () => {
      throw new Error("simulated GitHub failure");
    },
  };
  const pi = {
    run: () => ({
      text: '{"bump":"minor","rationale":"A command was added","evidence":["README documents the command"]}',
      provider: "test",
      model: "test",
    }),
  };

  assert.throws(
    () => proposeRelease({ cwd: repository }, { git: createGitClient(repository), github, pi }),
    /simulated GitHub failure/,
  );

  assert.equal(git(repository, ["branch", "--show-current"]).stdout.trim(), "main");
  assert.equal(git(repository, ["rev-parse", "HEAD"]).stdout.trim(), originalHead);
  assert.equal(git(repository, ["status", "--porcelain=v1"]).stdout, "");
  assert.equal(readFileSync(manifest, "utf8"), originalManifest);
  assert.equal(
    git(repository, ["show-ref", "--verify", "--quiet", "refs/heads/release/1.3.0"], [0, 1])
      .status,
    1,
  );
  assert.equal(
    git(repository, ["ls-remote", "--exit-code", "--heads", "origin", "release/1.3.0"], [0, 2])
      .status,
    2,
  );
});
