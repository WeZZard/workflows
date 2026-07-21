import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubClient } from "../src/github.mjs";
import { parseCliArgs, runCli } from "../src/cli.mjs";

test("parses the release command and all supported overrides", () => {
  assert.deepEqual(
    parseCliArgs([
      "propose",
      "--dry-run",
      "--version-file",
      "manifest.json",
      "--provider",
      "deepseek",
      "--model",
      "deepseek-v4-pro",
      "--thinking",
      "high",
    ]),
    {
      dryRun: true,
      versionFile: "manifest.json",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      thinking: "high",
    },
  );
  assert.throws(() => parseCliArgs([]), /Missing command/);
  assert.throws(() => parseCliArgs(["release"]), /Unknown command/);
  assert.throws(() => parseCliArgs(["propose", "extra"]), /Unexpected arguments/);
});

test("prints help and injected proposal output", () => {
  const messages = [];
  const output = {
    log: (value) => messages.push(value),
    error: (value) => messages.push(value),
  };
  assert.equal(runCli(["--help"], { output }), 0);
  assert.match(messages.pop(), /Usage: wezzard-release propose/);
  assert.equal(
    runCli(["propose", "--dry-run"], {
      output,
      propose: (options) => ({ ok: true, options }),
    }),
    0,
  );
  assert.match(messages.pop(), /"dryRun": true/);
});

test("uses the gh boundary for default branch, pull request list, and creation", () => {
  const invocations = [];
  const github = createGitHubClient("/repo", (command, args, options) => {
    invocations.push({ command, args, options });
    if (args[0] === "repo") {
      return { stdout: "main\n" };
    }
    if (args[1] === "list") {
      return { stdout: '[{"number":1,"headRefName":"feature"}]' };
    }
    return { stdout: "https://github.com/WeZZard/example/pull/2\n" };
  });

  assert.equal(github.defaultBranch(), "main");
  assert.equal(github.openPullRequests()[0].number, 1);
  assert.equal(
    github.createPullRequest({ base: "main", head: "release/1.0.1", title: "title", body: "body" }),
    "https://github.com/WeZZard/example/pull/2",
  );
  assert.equal(invocations.every(({ command }) => command === "gh"), true);
  assert.equal(invocations.every(({ options }) => options.cwd === "/repo"), true);
});
