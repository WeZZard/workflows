import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyWithRetry,
  createPiClient,
  finalAssistantResponseFromJsonLines,
  finalAssistantTextFromJsonLines,
  parseClassification,
  PI_TIMEOUT_MS,
  resolvePinnedPiCli,
} from "../src/pi.mjs";

function assistantEvent(text, provider = "deepseek", model = "deepseek-v4-pro") {
  return JSON.stringify({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], provider, model },
  });
}

test("extracts only the final assistant message from Pi JSON events", () => {
  const output = [
    JSON.stringify({ type: "message_update", assistantMessageEvent: { delta: "partial" } }),
    assistantEvent('{"bump":"patch"}'),
  ].join("\n");
  assert.equal(finalAssistantTextFromJsonLines(output), '{"bump":"patch"}');
  assert.deepEqual(finalAssistantResponseFromJsonLines(output), {
    text: '{"bump":"patch"}',
    provider: "deepseek",
    model: "deepseek-v4-pro",
  });
  assert.throws(() => finalAssistantTextFromJsonLines('{"type":"agent_end"}\n'), /no final/);
});

test("runs pinned Pi with only the exact skill and model overrides", () => {
  let invocation;
  const pi = createPiClient({
    cwd: "/repo",
    piCliPath: "/package/dist/cli.js",
    skillPath: "/package/internal/skills/version-bump/SKILL.md",
    execute(command, args, options) {
      invocation = { command, args, options };
      return {
        stdout: `${assistantEvent('{"bump":"minor","rationale":"Added API","evidence":["new export"]}')}\n`,
        stderr: "",
        status: 0,
      };
    },
  });
  const result = pi.run("/skill:version-bump classify", {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    thinking: "high",
  });

  assert.match(result.text, /"minor"/);
  assert.equal(result.provider, "deepseek");
  assert.equal(result.model, "deepseek-v4-pro");
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [
    "/package/dist/cli.js",
    "--print",
    "--mode",
    "json",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--skill",
    "/package/internal/skills/version-bump/SKILL.md",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-themes",
    "--no-approve",
    "--provider",
    "deepseek",
    "--model",
    "deepseek-v4-pro",
    "--thinking",
    "high",
  ]);
  assert.equal(invocation.options.input, "/skill:version-bump classify");
  assert.equal(invocation.options.env.PI_SKIP_VERSION_CHECK, "1");
  assert.equal(invocation.options.timeout, PI_TIMEOUT_MS);
});

test("resolves the pinned dependency's CLI entry point", () => {
  assert.match(
    resolvePinnedPiCli(),
    /node_modules\/@earendil-works\/pi-coding-agent\/dist\/cli\.js$/,
  );
});

test("validates the exact classification schema", () => {
  assert.deepEqual(
    parseClassification(
      '{"bump":"patch","rationale":" Fixed bug ","evidence":[" test "]}',
    ),
    { bump: "patch", rationale: "Fixed bug", evidence: ["test"] },
  );
  assert.throws(() => parseClassification("```json\n{}\n```"), /not valid JSON/);
  assert.throws(
    () => parseClassification('{"bump":"patch","rationale":"x","evidence":["y"],"next":"2.0.0"}'),
    /exactly/,
  );
  assert.throws(
    () => parseClassification('{"bump":"fix","rationale":"x","evidence":["y"]}'),
    /major, minor, or patch/,
  );
});

test("retries once and then returns or fails", () => {
  let attempts = 0;
  const prompts = [];
  const recovered = classifyWithRetry(
    {
      run(prompt) {
        attempts += 1;
        prompts.push(prompt);
        return attempts === 1
          ? "invalid"
          : '{"bump":"patch","rationale":"Fix","evidence":["diff"]}';
      },
    },
    "prompt",
  );
  assert.equal(attempts, 2);
  assert.equal(recovered.bump, "patch");
  assert.deepEqual(recovered.pi, { provider: "unknown", model: "unknown" });
  assert.equal(prompts[0], "prompt");
  assert.match(prompts[1], /## Correction required/);
  assert.match(prompts[1], /Pi response is not valid JSON/);

  attempts = 0;
  assert.throws(
    () =>
      classifyWithRetry(
        {
          run() {
            attempts += 1;
            throw new Error("provider unavailable");
          },
        },
        "prompt",
      ),
    /after one retry/,
  );
  assert.equal(attempts, 2);
});
