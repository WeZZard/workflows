import { chunkDiff, buildClassificationPrompt } from "./evidence.mjs";
import { loadVersionBumpExamples } from "./examples.mjs";
import { createGitClient } from "./git.mjs";
import { createGitHubClient } from "./github.mjs";
import {
  detectManifest,
  readManifestVersion,
  writeManifestVersion,
} from "./manifest.mjs";
import { classifyWithRetry, createPiClient } from "./pi.mjs";
import { bumpVersion, highestBump, stableVersionFromTag } from "./semver.mjs";

function formatModelSelection({ provider, model, thinking }) {
  return [
    `Provider: ${provider}`,
    `Model: ${model}`,
    `Thinking: ${thinking}`,
  ].join("\n");
}

export function buildPullRequestBody(result) {
  const rationales = result.classifications
    .map((classification, index) => `- Chunk ${index + 1}: ${classification.rationale}`)
    .join("\n");
  const evidence = [
    ...new Set(result.classifications.flatMap((classification) => classification.evidence)),
  ]
    .map((item) => `- ${item}`)
    .join("\n");

  return [
    `Pi classified this as a **${result.bump}** release (${result.current} → ${result.next}).`,
    "",
    `Base tag: ${result.sinceTag ?? `none (unpublished manifest baseline ${result.current})`}`,
    `Commits: ${result.commits}`,
    `Diff chunks: ${result.chunks}`,
    formatModelSelection(result.pi),
    "",
    "## Rationale",
    rationales,
    "",
    "## Evidence",
    evidence,
    "",
    "Merge this pull request to run the deterministic tag and catalog release workflow.",
  ].join("\n");
}

function validateVersionBaseline(current, sinceTag) {
  if (sinceTag === null) {
    // With no published release, the valid manifest version is the explicit
    // unpublished baseline. Full repository history is classified from it.
    return;
  }

  const taggedVersion = stableVersionFromTag(sinceTag);
  if (current !== taggedVersion) {
    throw new Error(
      `Manifest version ${current} must match latest stable tag ${sinceTag} (${taggedVersion}) before proposing a release`,
    );
  }
}

function rollbackReleaseMutation({
  git,
  branch,
  defaultBranch,
  manifestPath,
  branchCreated,
  pushAttempted,
  pushCompleted,
  releaseCommit,
}) {
  const failures = [];
  const attempt = (description, operation) => {
    try {
      return operation();
    } catch (error) {
      failures.push(`${description}: ${error.message}`);
      return undefined;
    }
  };

  let deleteRemote = pushCompleted;
  if (!deleteRemote && pushAttempted && releaseCommit) {
    const remoteCommit = attempt("inspect the remote release branch", () =>
      git.remoteBranchCommit(branch),
    );
    deleteRemote = remoteCommit === releaseCommit;
    if (remoteCommit && remoteCommit !== releaseCommit) {
      failures.push(
        `delete remote branch ${branch}: expected ${releaseCommit}, found ${remoteCommit}; left it intact`,
      );
    }
  }

  if (branchCreated) {
    const currentBranch = attempt("inspect the current branch", () => git.currentBranch());
    if (currentBranch === branch) {
      attempt(`restore ${manifestPath}`, () => git.restorePath(manifestPath));
    }
    if (currentBranch !== defaultBranch) {
      attempt(`return to ${defaultBranch}`, () => git.switchBranch(defaultBranch));
    }

    const localBranchExists = attempt("inspect the local release branch", () =>
      git.localBranchExists(branch),
    );
    if (localBranchExists) {
      attempt(`delete local branch ${branch}`, () => git.deleteLocalBranch(branch));
    }
  }

  if (deleteRemote && releaseCommit) {
    attempt(`delete remote branch ${branch}`, () =>
      git.deleteRemoteBranch(branch, releaseCommit),
    );
  }

  const finalBranch = attempt("verify the restored branch", () => git.currentBranch());
  if (finalBranch !== undefined && finalBranch !== defaultBranch) {
    failures.push(
      `verify the restored branch: expected ${defaultBranch}, found ${finalBranch || "detached HEAD"}`,
    );
  }
  const finalStatus = attempt("verify the restored working tree", () => git.status());
  if (finalStatus?.trim()) {
    failures.push(`verify the restored working tree: repository is not clean:\n${finalStatus.trimEnd()}`);
  }

  return failures;
}

function throwMutationError(error, rollbackFailures) {
  if (rollbackFailures.length === 0) {
    throw error;
  }
  throw new Error(
    `${error.message}\nRelease rollback also failed:\n- ${rollbackFailures.join("\n- ")}`,
    { cause: error },
  );
}

export function proposeRelease(
  {
    cwd = process.cwd(),
    dryRun = false,
    versionFile,
    provider,
    model,
    thinking,
  } = {},
  dependencies = {},
) {
  const git = dependencies.git ?? createGitClient(cwd);
  const repositoryRoot = git.root();
  const github = dependencies.github ?? createGitHubClient(repositoryRoot);
  const pi = dependencies.pi ?? createPiClient({ cwd: repositoryRoot });
  const loadExamples = dependencies.loadExamples ?? loadVersionBumpExamples;
  const readVersion = dependencies.readVersion ?? readManifestVersion;
  const writeVersion = dependencies.writeVersion ?? writeManifestVersion;
  const findManifest = dependencies.findManifest ?? detectManifest;

  const dirty = git.status();
  if (dirty.trim()) {
    throw new Error(`Working tree must be clean before proposing a release:\n${dirty.trimEnd()}`);
  }

  const defaultBranch = github.defaultBranch();
  const currentBranch = git.currentBranch();
  if (currentBranch !== defaultBranch) {
    throw new Error(
      `Run the release command on the default branch ${defaultBranch}; current branch is ${currentBranch || "detached HEAD"}`,
    );
  }

  git.fetchDefaultBranch(defaultBranch);
  const headCommit = git.headCommit();
  const remoteCommit = git.remoteCommit(defaultBranch);
  if (headCommit !== remoteCommit) {
    throw new Error(
      `Local ${defaultBranch} must match origin/${defaultBranch} before proposing a release`,
    );
  }

  const openRelease = github
    .openPullRequests()
    .find((pullRequest) => pullRequest.headRefName?.startsWith("release/"));
  if (openRelease) {
    throw new Error(
      `An open release pull request already exists: ${openRelease.url ?? `#${openRelease.number}`}`,
    );
  }

  const manifest = findManifest(repositoryRoot, versionFile);
  const current = readVersion(manifest.absolutePath);
  const sinceTag = git.latestStableTag();
  validateVersionBaseline(current, sinceTag);
  const commits = git.commitCount(sinceTag);
  const base = git.evidenceBase(sinceTag);
  const commitLog = git.commitLog(sinceTag);
  const changedPaths = git.changedPaths(base);
  const diff = git.diff(base);
  if (commits === 0 || diff.length === 0) {
    throw new Error("No committed changes exist since the latest stable tag");
  }

  const chunks = chunkDiff(diff);
  const examples = loadExamples(repositoryRoot);
  const classifications = chunks.map((chunk, chunkIndex) => {
    const prompt = buildClassificationPrompt({
      currentVersion: current,
      baseTag: sinceTag,
      commitLog,
      changedPaths,
      examples,
      chunk,
      chunkIndex,
      chunkCount: chunks.length,
    });
    return classifyWithRetry(pi, prompt, { provider, model, thinking });
  });
  const bump = highestBump(classifications);
  const next = bumpVersion(current, bump);
  const providers = [...new Set(classifications.map(({ pi: runtime }) => runtime.provider))];
  const models = [...new Set(classifications.map(({ pi: runtime }) => runtime.model))];
  const branch = `release/${next}`;
  if (git.branchExists(branch)) {
    throw new Error(`Release branch already exists: ${branch}`);
  }

  const result = {
    dryRun,
    current,
    next,
    bump,
    sinceTag,
    commits,
    chunks: chunks.length,
    versionFile: manifest.relativePath,
    branch,
    classifications,
    pi: {
      provider: providers.join(", "),
      model: models.join(", "),
      thinking: thinking ?? "inherited",
    },
    source: "pi",
  };
  if (dryRun) {
    return result;
  }

  let branchCreated = false;
  let pushAttempted = false;
  let pushCompleted = false;
  let releaseCommit;
  try {
    branchCreated = true;
    git.createBranch(branch);
    writeVersion(manifest.absolutePath, current, next);
    git.stage(manifest.relativePath);
    const stagedPaths = git.stagedPaths();
    if (stagedPaths.length !== 1 || stagedPaths[0] !== manifest.relativePath) {
      throw new Error(
        `Release commit must contain only ${manifest.relativePath}; staged: ${stagedPaths.join(", ") || "none"}`,
      );
    }
    git.commit(`release: bump to ${next} (${bump})`);
    releaseCommit = git.headCommit();
    pushAttempted = true;
    git.push(branch);
    pushCompleted = true;

    const pullRequest = github.createPullRequest({
      base: defaultBranch,
      head: branch,
      title: `release: v${next}`,
      body: buildPullRequestBody(result),
    });
    return { ...result, pullRequest };
  } catch (error) {
    const rollbackFailures = rollbackReleaseMutation({
      git,
      branch,
      defaultBranch,
      manifestPath: manifest.relativePath,
      branchCreated,
      pushAttempted,
      pushCompleted,
      releaseCommit,
    });
    throwMutationError(error, rollbackFailures);
  }
}
