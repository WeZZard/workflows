import { parseArgs } from "node:util";
import { proposeRelease } from "./release.mjs";

const HELP = `Usage: wezzard-release propose [options]

Create a Pi-classified SemVer release pull request from the synchronized default branch.

Options:
  --dry-run              Classify without creating a branch, commit, push, or pull request
  --version-file <path>  Override manifest auto-detection
  --provider <name>      Override Pi's configured provider
  --model <id>           Override Pi's configured model
  --thinking <level>     Override Pi's configured thinking level
  -h, --help             Show this help
`;

export function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  if (command === undefined) {
    throw new Error("Missing command. Run wezzard-release --help for usage.");
  }
  if (command === "--help" || command === "-h") {
    return { help: true };
  }
  if (command !== "propose") {
    throw new Error(`Unknown command: ${command}`);
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      "version-file": { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      thinking: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (positionals.length > 0) {
    throw new Error(`Unexpected arguments: ${positionals.join(" ")}`);
  }
  if (values.help) {
    return { help: true };
  }
  return {
    dryRun: values["dry-run"],
    versionFile: values["version-file"],
    provider: values.provider,
    model: values.model,
    thinking: values.thinking,
  };
}

export function runCli(argv, { output = console, propose = proposeRelease } = {}) {
  try {
    const options = parseCliArgs(argv);
    if (options.help) {
      output.log(HELP.trimEnd());
      return 0;
    }
    const result = propose(options);
    output.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    output.error(`wezzard-release: ${error.message}`);
    process.exitCode = 1;
    return 1;
  }
}
