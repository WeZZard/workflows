import { spawnSync } from "node:child_process";

const DEFAULT_MAX_BUFFER = 1024 * 1024 * 1024;

export function runProcess(
  command,
  args,
  {
    cwd = process.cwd(),
    env = process.env,
    input,
    acceptedExitCodes = [0],
    maxBuffer = DEFAULT_MAX_BUFFER,
    timeout,
  } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    maxBuffer,
    timeout,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`Could not run ${command}: ${result.error.message}`);
  }
  if (!acceptedExitCodes.includes(result.status)) {
    const detail = (result.stderr || result.stdout || "no output").trim();
    throw new Error(`${command} exited with status ${result.status}: ${detail}`);
  }

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
