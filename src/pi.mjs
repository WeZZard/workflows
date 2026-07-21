import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "./process.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const VERSION_BUMP_SKILL = join(packageRoot, "skills/version-bump/SKILL.md");
export const PI_TIMEOUT_MS = 15 * 60 * 1000;

export function resolvePinnedPiCli() {
  const piIndex = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(piIndex), "cli.js");
}

export function finalAssistantResponseFromJsonLines(stdout) {
  let finalResponse = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Pi emitted an invalid JSON event: ${error.message}`);
    }
    if (event.type !== "message_end" || event.message?.role !== "assistant") {
      continue;
    }
    const text = Array.isArray(event.message.content)
      ? event.message.content
          .filter((part) => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("")
      : "";
    if (text) {
      finalResponse = {
        text,
        provider: event.message.provider,
        model: event.message.model,
      };
    }
  }
  if (finalResponse === null) {
    throw new Error("Pi produced no final assistant message");
  }
  if (
    typeof finalResponse.provider !== "string" ||
    finalResponse.provider.trim() === "" ||
    typeof finalResponse.model !== "string" ||
    finalResponse.model.trim() === ""
  ) {
    throw new Error("Pi final assistant message omitted provider or model provenance");
  }
  return finalResponse;
}

export function finalAssistantTextFromJsonLines(stdout) {
  return finalAssistantResponseFromJsonLines(stdout).text;
}

export function createPiClient({
  cwd = process.cwd(),
  execute = runProcess,
  piCliPath = resolvePinnedPiCli(),
  skillPath = VERSION_BUMP_SKILL,
} = {}) {
  return {
    run(prompt, { provider, model, thinking } = {}) {
      const args = [
        piCliPath,
        "--print",
        "--mode",
        "json",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--skill",
        skillPath,
        "--no-context-files",
        "--no-prompt-templates",
        "--no-themes",
        "--no-approve",
      ];
      if (provider) {
        args.push("--provider", provider);
      }
      if (model) {
        args.push("--model", model);
      }
      if (thinking) {
        args.push("--thinking", thinking);
      }

      const result = execute(process.execPath, args, {
        cwd,
        input: prompt,
        env: {
          ...process.env,
          PI_SKIP_VERSION_CHECK: "1",
        },
        maxBuffer: 64 * 1024 * 1024,
        timeout: PI_TIMEOUT_MS,
      });
      return finalAssistantResponseFromJsonLines(result.stdout);
    },
  };
}

export function parseClassification(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Pi response is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi response must be a JSON object");
  }
  const expectedKeys = ["bump", "evidence", "rationale"];
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`Pi response must contain exactly: ${expectedKeys.join(", ")}`);
  }
  if (!["major", "minor", "patch"].includes(value.bump)) {
    throw new Error("Pi response bump must be major, minor, or patch");
  }
  if (typeof value.rationale !== "string" || value.rationale.trim() === "") {
    throw new Error("Pi response rationale must be a non-empty string");
  }
  if (
    !Array.isArray(value.evidence) ||
    value.evidence.length === 0 ||
    value.evidence.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error("Pi response evidence must contain non-empty strings");
  }
  return {
    bump: value.bump,
    rationale: value.rationale.trim(),
    evidence: value.evidence.map((item) => item.trim()),
  };
}

export function classifyWithRetry(pi, prompt, modelOptions = {}) {
  const failures = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const attemptPrompt = attempt === 1
        ? prompt
        : [
            prompt,
            "",
            "## Correction required",
            `Your previous response failed validation: ${failures.at(-1)}`,
            "Return a corrected JSON object that exactly matches the required schema.",
          ].join("\n");
      const response = pi.run(attemptPrompt, modelOptions);
      const text = typeof response === "string" ? response : response.text;
      const classification = parseClassification(text);
      return {
        ...classification,
        pi: {
          provider: response.provider ?? modelOptions.provider ?? "unknown",
          model: response.model ?? modelOptions.model ?? "unknown",
        },
      };
    } catch (error) {
      failures.push(`attempt ${attempt}: ${error.message}`);
    }
  }
  throw new Error(`Pi failed to classify the diff after one retry (${failures.join("; ")})`);
}
