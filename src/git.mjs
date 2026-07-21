import { realpathSync } from "node:fs";
import { isStableVersionTag } from "./semver.mjs";
import { runProcess } from "./process.mjs";

export function createGitClient(cwd = process.cwd(), execute = runProcess) {
  const call = (args, options = {}) => execute("git", args, { cwd, ...options });
  const stdout = (args, options = {}) => call(args, options).stdout;

  return {
    root() {
      const root = stdout(["rev-parse", "--show-toplevel"]).trim();
      return realpathSync(root);
    },

    status() {
      return stdout(["status", "--porcelain=v1", "--untracked-files=all"]);
    },

    currentBranch() {
      return stdout(["branch", "--show-current"]).trim();
    },

    fetchDefaultBranch(branch) {
      call([
        "fetch",
        "--quiet",
        "origin",
        `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ]);
    },

    headCommit() {
      return stdout(["rev-parse", "HEAD"]).trim();
    },

    remoteCommit(branch) {
      return stdout(["rev-parse", `refs/remotes/origin/${branch}`]).trim();
    },

    latestStableTag() {
      const tags = stdout(["tag", "--merged", "HEAD", "--sort=-version:refname"])
        .split("\n")
        .map((tag) => tag.trim())
        .filter(Boolean);
      return tags.find(isStableVersionTag) ?? null;
    },

    evidenceBase(tag) {
      if (tag) {
        return tag;
      }
      return stdout(["hash-object", "-t", "tree", "--stdin"], { input: "" }).trim();
    },

    commitCount(tag) {
      const range = tag ? `${tag}..HEAD` : "HEAD";
      return Number(stdout(["rev-list", "--count", range]).trim());
    },

    commitLog(tag) {
      const range = tag ? `${tag}..HEAD` : "HEAD";
      return stdout([
        "log",
        "--no-decorate",
        "--format=commit %H%nsubject: %s%nbody:%n%b%n--END-COMMIT--",
        range,
      ]).trimEnd();
    },

    changedPaths(base) {
      return stdout(["diff", "--no-renames", "--name-status", base, "HEAD", "--"]).trimEnd();
    },

    diff(base) {
      return stdout([
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--full-index",
        "--find-renames",
        base,
        "HEAD",
        "--",
      ]);
    },

    branchExists(branch) {
      const local = call(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
        acceptedExitCodes: [0, 1],
      }).status;
      const remote = call(["ls-remote", "--exit-code", "--heads", "origin", branch], {
        acceptedExitCodes: [0, 2],
      }).status;
      return local === 0 || remote === 0;
    },

    localBranchExists(branch) {
      return (
        call(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
          acceptedExitCodes: [0, 1],
        }).status === 0
      );
    },

    remoteBranchCommit(branch) {
      const result = call(["ls-remote", "--exit-code", "--heads", "origin", branch], {
        acceptedExitCodes: [0, 2],
      });
      if (result.status === 2) {
        return null;
      }
      const line = result.stdout
        .split("\n")
        .map((value) => value.trim())
        .find(Boolean);
      return line?.split(/\s+/, 1)[0] ?? null;
    },

    createBranch(branch) {
      call(["switch", "--create", branch]);
    },

    switchBranch(branch) {
      call(["switch", branch]);
    },

    restorePath(path) {
      call(["restore", "--staged", "--worktree", "--", path]);
    },

    deleteLocalBranch(branch) {
      call(["branch", "--delete", "--force", branch]);
    },

    stage(path) {
      call(["add", "--", path]);
    },

    stagedPaths() {
      return stdout(["diff", "--cached", "--name-only", "--"])
        .split("\n")
        .map((path) => path.trim())
        .filter(Boolean);
    },

    commit(message) {
      call(["commit", "--message", message]);
    },

    push(branch) {
      call([
        "push",
        "--set-upstream",
        `--force-with-lease=refs/heads/${branch}:`,
        "origin",
        `refs/heads/${branch}:refs/heads/${branch}`,
      ]);
    },

    deleteRemoteBranch(branch, expectedCommit) {
      call([
        "push",
        `--force-with-lease=refs/heads/${branch}:${expectedCommit}`,
        "origin",
        `:refs/heads/${branch}`,
      ]);
    },
  };
}
