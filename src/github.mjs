import { runProcess } from "./process.mjs";

export function createGitHubClient(cwd = process.cwd(), execute = runProcess) {
  const call = (args) => execute("gh", args, { cwd });

  return {
    defaultBranch() {
      const branch = call([
        "repo",
        "view",
        "--json",
        "defaultBranchRef",
        "--jq",
        ".defaultBranchRef.name",
      ]).stdout.trim();
      if (!branch) {
        throw new Error("GitHub did not report a default branch");
      }
      return branch;
    },

    openPullRequests() {
      const output = call([
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "1000",
        "--json",
        "number,headRefName,title,url",
      ]).stdout;
      try {
        const pullRequests = JSON.parse(output);
        if (!Array.isArray(pullRequests)) {
          throw new Error("response is not an array");
        }
        return pullRequests;
      } catch (error) {
        throw new Error(`Could not parse GitHub pull requests: ${error.message}`);
      }
    },

    createPullRequest({ base, head, title, body }) {
      const url = call([
        "pr",
        "create",
        "--base",
        base,
        "--head",
        head,
        "--title",
        title,
        "--body",
        body,
      ]).stdout.trim();
      if (!url) {
        throw new Error("GitHub did not return a pull request URL");
      }
      return url.split("\n").at(-1).trim();
    },
  };
}
