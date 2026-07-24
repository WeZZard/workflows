import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proposeRelease } from "../src/release.mjs";

function fixture({
  status = "",
  branch = "main",
  head = "abc",
  remote = "abc",
  open = [],
  tag = "v1.2.3",
  stagedPaths,
  companions = false,
  failAt,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "wezzard-release-orchestration-"));
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  const manifest = join(root, ".claude-plugin/plugin.json");
  const originalManifest = '{\n  "name": "fixture",\n  "version": "1.2.3"\n}\n';
  writeFileSync(manifest, originalManifest);
  const originalFiles = new Map([[".claude-plugin/plugin.json", originalManifest]]);
  if (companions) {
    mkdirSync(join(root, ".codex-plugin"), { recursive: true });
    originalFiles.set(
      ".codex-plugin/plugin.json",
      '{\n  "name": "fixture",\n  "version": "1.2.3"\n}\n',
    );
    originalFiles.set(
      "package.json",
      '{\n  "name": "fixture",\n  "version": "1.2.3"\n}\n',
    );
    originalFiles.set(
      "package-lock.json",
      '{\n  "name": "fixture",\n  "version": "1.2.3",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "fixture",\n      "version": "1.2.3"\n    }\n  }\n}\n',
    );
    for (const [path, contents] of [...originalFiles].slice(1)) {
      writeFileSync(join(root, path), contents);
    }
  }
  const expectedVersionPaths = [...originalFiles.keys()];
  const reportedStagedPaths = stagedPaths ?? expectedVersionPaths;
  const calls = [];
  let currentBranch = branch;
  let currentHead = head;
  const localBranches = new Set([branch]);
  const remoteBranches = new Map();
  const fail = (operation) => {
    if (failAt === operation) {
      throw new Error(`${operation} failed`);
    }
  };
  const git = {
    root: () => root,
    status: () => status,
    currentBranch: () => currentBranch,
    fetchDefaultBranch: (value) => calls.push(["fetch", value]),
    headCommit: () => currentHead,
    remoteCommit: () => remote,
    latestStableTag: () => tag,
    commitCount: () => 2,
    evidenceBase: (tag) => tag,
    commitLog: () => "subject: feat: add command",
    changedPaths: () => "M\tsrc/command.mjs",
    diff: () => "diff --git a/src/command.mjs b/src/command.mjs\n+export const command = true;\n",
    branchExists: () => false,
    localBranchExists: (value) => localBranches.has(value),
    remoteBranchCommit: (value) => remoteBranches.get(value) ?? null,
    createBranch: (value) => {
      fail("createBranch");
      calls.push(["createBranch", value]);
      localBranches.add(value);
      currentBranch = value;
    },
    switchBranch: (value) => {
      calls.push(["switchBranch", value]);
      currentBranch = value;
      currentHead = head;
    },
    restorePath: (value) => {
      calls.push(["restorePath", value]);
      writeFileSync(join(root, value), originalFiles.get(value));
    },
    deleteLocalBranch: (value) => {
      calls.push(["deleteLocalBranch", value]);
      localBranches.delete(value);
    },
    stage: (value) => {
      calls.push(["stage", value]);
      fail("stage");
    },
    stagedPaths: () => reportedStagedPaths,
    commit: (value) => {
      calls.push(["commit", value]);
      fail("commit");
      currentHead = "release-commit";
    },
    push: (value) => {
      calls.push(["push", value]);
      if (failAt === "push-after-update") {
        remoteBranches.set(value, currentHead);
        throw new Error("push failed after update");
      }
      if (failAt === "push-remote-race") {
        remoteBranches.set(value, "someone-elses-commit");
        throw new Error("push rejected by remote race");
      }
      fail("push");
      remoteBranches.set(value, currentHead);
    },
    deleteRemoteBranch: (value, expectedCommit) => {
      calls.push(["deleteRemoteBranch", value, expectedCommit]);
      if (remoteBranches.get(value) === expectedCommit) {
        remoteBranches.delete(value);
      }
    },
  };
  let createdPullRequest;
  const github = {
    defaultBranch: () => "main",
    openPullRequests: () => open,
    createPullRequest: (request) => {
      createdPullRequest = request;
      calls.push(["pullRequest", request.head]);
      fail("pullRequest");
      return "https://github.com/WeZZard/example/pull/1";
    },
  };
  const prompts = [];
  const pi = {
    run(prompt, options) {
      prompts.push({ prompt, options });
      return {
        text: '{"bump":"minor","rationale":"A command was added","evidence":["src/command.mjs adds an export"]}',
        provider: "deepseek",
        model: "deepseek-v4-pro",
      };
    },
  };
  return {
    root,
    manifest,
    git,
    github,
    pi,
    calls,
    prompts,
    getPullRequest: () => createdPullRequest,
    getCurrentBranch: () => currentBranch,
    hasLocalBranch: (value) => localBranches.has(value),
    hasRemoteBranch: (value) => remoteBranches.has(value),
    originalFiles,
    expectedVersionPaths,
  };
}

test("dry-run classifies without creating release mutations", () => {
  const f = fixture();
  const result = proposeRelease(
    {
      cwd: f.root,
      dryRun: true,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      thinking: "high",
    },
    { git: f.git, github: f.github, pi: f.pi },
  );

  assert.equal(result.current, "1.2.3");
  assert.equal(result.next, "1.3.0");
  assert.equal(result.bump, "minor");
  assert.equal(result.branch, "release/1.3.0");
  assert.deepEqual(result.versionFiles, [".claude-plugin/plugin.json"]);
  assert.deepEqual(result.pi, {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    thinking: "high",
  });
  assert.deepEqual(f.calls, [["fetch", "main"]]);
  assert.equal(readFileSync(f.manifest, "utf8").includes('"version": "1.2.3"'), true);
  assert.deepEqual(f.prompts[0].options, {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    thinking: "high",
  });
  assert.match(f.prompts[0].prompt, /^\/skill:version-bump /);
});

test("creates the version commit, pushes it, and opens a pull request", () => {
  const f = fixture();
  const result = proposeRelease({}, { git: f.git, github: f.github, pi: f.pi });

  assert.equal(result.pullRequest, "https://github.com/WeZZard/example/pull/1");
  assert.match(readFileSync(f.manifest, "utf8"), /"version": "1\.3\.0"/);
  assert.deepEqual(f.calls, [
    ["fetch", "main"],
    ["createBranch", "release/1.3.0"],
    ["stage", ".claude-plugin/plugin.json"],
    ["commit", "release: bump to 1.3.0 (minor)"],
    ["push", "release/1.3.0"],
    ["pullRequest", "release/1.3.0"],
  ]);
  assert.equal(f.getPullRequest().base, "main");
  assert.match(f.getPullRequest().body, /Pi classified this as a \*\*minor\*\*/);
  assert.match(f.getPullRequest().body, /Provider: deepseek/);
  assert.match(f.getPullRequest().body, /Model: deepseek-v4-pro/);
  assert.match(f.getPullRequest().body, /Thinking: inherited/);
});

test("updates, stages, and reports every synchronized version file", () => {
  const f = fixture({ companions: true });
  const result = proposeRelease({}, { git: f.git, github: f.github, pi: f.pi });

  assert.deepEqual(result.versionFiles, f.expectedVersionPaths);
  for (const path of f.expectedVersionPaths) {
    assert.match(readFileSync(join(f.root, path), "utf8"), /"version": "1\.3\.0"/);
    assert.ok(f.calls.some((call) => call[0] === "stage" && call[1] === path));
  }
  assert.match(f.getPullRequest().body, /Version files: .*package-lock\.json/);
});

test("restores every synchronized version file after a release mutation fails", () => {
  const f = fixture({ companions: true, failAt: "pullRequest" });

  assert.throws(
    () => proposeRelease({}, { git: f.git, github: f.github, pi: f.pi }),
    /pullRequest failed/,
  );
  for (const [path, original] of f.originalFiles) {
    assert.equal(readFileSync(join(f.root, path), "utf8"), original);
    assert.ok(f.calls.some((call) => call[0] === "restorePath" && call[1] === path));
  }
});

test("requires the manifest version to match the latest stable tag", () => {
  const f = fixture({ tag: "v1.2.2" });

  assert.throws(
    () => proposeRelease({ dryRun: true }, { git: f.git, github: f.github, pi: f.pi }),
    /Manifest version 1\.2\.3 must match latest stable tag v1\.2\.2 \(1\.2\.2\)/,
  );
  assert.equal(f.prompts.length, 0);
  assert.deepEqual(f.calls, [["fetch", "main"]]);
});

test("stops before Pi when a synchronized version file disagrees", () => {
  const f = fixture({ companions: true });
  writeFileSync(join(f.root, "package.json"), '{"name":"fixture","version":"9.0.0"}\n');

  assert.throws(
    () => proposeRelease({ dryRun: true }, { git: f.git, github: f.github, pi: f.pi }),
    /package\.json=9\.0\.0/,
  );
  assert.equal(f.prompts.length, 0);
  assert.deepEqual(f.calls, [["fetch", "main"]]);
});

test("an explicit version file leaves independent companions unchanged", () => {
  const f = fixture({ companions: true, stagedPaths: [".claude-plugin/plugin.json"] });
  const independentPath = join(f.root, "package.json");
  const independent = '{"name":"fixture","version":"9.0.0"}\n';
  writeFileSync(independentPath, independent);

  const result = proposeRelease(
    { versionFile: ".claude-plugin/plugin.json" },
    { git: f.git, github: f.github, pi: f.pi },
  );

  assert.deepEqual(result.versionFiles, [".claude-plugin/plugin.json"]);
  assert.equal(readFileSync(independentPath, "utf8"), independent);
  assert.equal(
    f.calls.some((call) => call[0] === "stage" && call[1] === "package.json"),
    false,
  );
});

test("uses the manifest as the unpublished baseline when no stable tag exists", () => {
  const f = fixture({ tag: null });
  const result = proposeRelease(
    { dryRun: true },
    { git: f.git, github: f.github, pi: f.pi },
  );

  assert.equal(result.sinceTag, null);
  assert.equal(result.current, "1.2.3");
  assert.equal(result.next, "1.3.0");
  assert.match(f.prompts[0].prompt, /Latest stable tag: \(none; initial release history\)/);
});

test("rolls back every failed mutation after creating the release branch", async (t) => {
  const cases = [
    {
      name: "manifest write",
      options: {},
      dependencies: (f) => ({
        writeVersions(versionSet) {
          writeFileSync(versionSet.primary.absolutePath, "partially written\n");
          throw new Error("manifest write failed");
        },
      }),
      message: /manifest write failed/,
    },
    { name: "stage", options: { failAt: "stage" }, message: /stage failed/ },
    {
      name: "staged-path validation",
      options: { stagedPaths: ["README.md"] },
      message: /Release commit must contain exactly/,
    },
    { name: "commit", options: { failAt: "commit" }, message: /commit failed/ },
    { name: "push before remote update", options: { failAt: "push" }, message: /push failed/ },
    {
      name: "push after remote update",
      options: { failAt: "push-after-update" },
      message: /push failed after update/,
    },
    {
      name: "pull-request creation",
      options: { failAt: "pullRequest" },
      message: /pullRequest failed/,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const f = fixture(item.options);
      const original = readFileSync(f.manifest, "utf8");
      const extraDependencies = item.dependencies?.(f) ?? {};

      assert.throws(
        () =>
          proposeRelease(
            {},
            { git: f.git, github: f.github, pi: f.pi, ...extraDependencies },
          ),
        item.message,
      );

      assert.equal(f.getCurrentBranch(), "main");
      assert.equal(f.hasLocalBranch("release/1.3.0"), false);
      assert.equal(f.hasRemoteBranch("release/1.3.0"), false);
      assert.equal(readFileSync(f.manifest, "utf8"), original);
      assert.ok(f.calls.some(([operation]) => operation === "switchBranch"));
      assert.ok(f.calls.some(([operation]) => operation === "deleteLocalBranch"));
      if (item.options.failAt === "push-after-update" || item.options.failAt === "pullRequest") {
        assert.ok(f.calls.some(([operation]) => operation === "deleteRemoteBranch"));
      } else {
        assert.equal(f.calls.some(([operation]) => operation === "deleteRemoteBranch"), false);
      }
    });
  }
});

test("does not delete a remote release branch created by another writer", () => {
  const f = fixture({ failAt: "push-remote-race" });

  assert.throws(
    () => proposeRelease({}, { git: f.git, github: f.github, pi: f.pi }),
    /expected release-commit, found someone-elses-commit; left it intact/,
  );

  assert.equal(f.getCurrentBranch(), "main");
  assert.equal(f.hasLocalBranch("release/1.3.0"), false);
  assert.equal(f.hasRemoteBranch("release/1.3.0"), true);
  assert.match(readFileSync(f.manifest, "utf8"), /"version": "1\.2\.3"/);
  assert.equal(f.calls.some(([operation]) => operation === "deleteRemoteBranch"), false);
});

test("leaves the repository unchanged when Pi fails twice", () => {
  const f = fixture();
  let attempts = 0;
  f.pi.run = () => {
    attempts += 1;
    throw new Error("provider unavailable");
  };
  const original = readFileSync(f.manifest, "utf8");

  assert.throws(
    () => proposeRelease({}, { git: f.git, github: f.github, pi: f.pi }),
    /after one retry/,
  );
  assert.equal(attempts, 2);
  assert.equal(readFileSync(f.manifest, "utf8"), original);
  assert.deepEqual(f.calls, [["fetch", "main"]]);
});

test("stops before Pi when repository preconditions fail", async (t) => {
  const cases = [
    {
      name: "dirty worktree",
      fixture: { status: " M README.md\n" },
      message: /Working tree must be clean/,
    },
    {
      name: "wrong branch",
      fixture: { branch: "feature" },
      message: /default branch main/,
    },
    {
      name: "unsynchronized branch",
      fixture: { head: "abc", remote: "def" },
      message: /must match origin\/main/,
    },
    {
      name: "open release pull request",
      fixture: { open: [{ headRefName: "release/1.2.4", url: "https://example.test/pr" }] },
      message: /already exists/,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      const f = fixture(item.fixture);
      assert.throws(
        () => proposeRelease({ dryRun: true }, { git: f.git, github: f.github, pi: f.pi }),
        item.message,
      );
      assert.equal(f.prompts.length, 0);
    });
  }
});
