import assert from "node:assert/strict";
import test from "node:test";
import { runOpenAIExecutorLiveSmoke, resolveLiveSmokeGate } from "../../src/live-smoke";

test("live smoke gating skips clearly when OPENAI_API_KEY is missing", () => {
  const gate = resolveLiveSmokeGate({
    apiKey: null,
    enabled: true,
  });

  assert.equal(gate.runnable, false);
  assert.equal(gate.result?.status, "skipped");
  assert.equal(gate.result?.reason.includes("OPENAI_API_KEY"), true);
});

test(
  "live smoke can run against the real OpenAI executor when env is present",
  {
    skip: !process.env.OPENAI_API_KEY,
  },
  async () => {
    const result = await runOpenAIExecutorLiveSmoke({
      apiKey: process.env.OPENAI_API_KEY,
      enabled: true,
    });

    assert.equal(result.status, "passed");
    assert.equal(Boolean(result.reportPath), true);
    assert.equal(Boolean(result.diffPath), true);
  },
);
