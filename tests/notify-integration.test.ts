import assert from "node:assert/strict";
import test from "node:test";
import { buildTransactionalEmailHtml, sendNotification } from "../lib/integrations/notify";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "EMAIL_NOTIFY_ENDPOINT",
  "EMAIL_NOTIFY_TOKEN",
  "EMAIL_NOTIFY_PROVIDER",
  "EMAIL_NOTIFY_FROM",
  "EMAIL_NOTIFY_REPLY_TO",
] as const;

test("email notifications use the Resend API when RESEND_API_KEY is configured", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ id: "email_test_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_NOTIFY_FROM = "BIG E Fitness <no-reply@auth.bigefitness.com>";
  process.env.EMAIL_NOTIFY_REPLY_TO = "support@example.com";
  delete process.env.EMAIL_NOTIFY_ENDPOINT;
  delete process.env.EMAIL_NOTIFY_TOKEN;
  delete process.env.EMAIL_NOTIFY_PROVIDER;

  try {
    const result = await sendNotification({
      channel: "email",
      target: "coach@example.com",
      templateKey: "BIG E 員工 Email 驗證",
      message: "請完成 Email 驗證",
    });

    assert.deepEqual(result, {
      ok: true,
      providerRef: "email_test_123",
      error: null,
    });
    assert.equal(capturedUrl, "https://api.resend.com/emails");
    assert.equal(
      (capturedInit?.headers as Record<string, string>).Authorization,
      "Bearer re_test_key",
    );
    const payload = JSON.parse(String(capturedInit?.body));
    assert.equal(payload.from, "BIG E Fitness <no-reply@auth.bigefitness.com>");
    assert.deepEqual(payload.to, ["coach@example.com"]);
    assert.equal(payload.subject, "BIG E 員工 Email 驗證");
    assert.equal(payload.text, "請完成 Email 驗證");
    assert.deepEqual(payload.reply_to, ["support@example.com"]);
    assert.match(payload.html, /<!doctype html>/i);
    assert.match(payload.html, /BIG E FITNESS/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("transactional HTML escapes user content and renders HTTPS links as a CTA", () => {
  const html = buildTransactionalEmailHtml(
    "Hello <member>\n\nhttps://www.bigefitness.com/check-in/verify?token=a&entry=member",
  );
  assert.match(html, /Hello &lt;member&gt;/);
  assert.match(
    html,
    /href="https:\/\/www\.bigefitness\.com\/check-in\/verify\?token=a&amp;entry=member"/,
  );
  assert.doesNotMatch(html, /Hello <member>/);
});

test("Resend email notifications require a verified sender", async () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_NOTIFY_FROM;
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.EMAIL_NOTIFY_FROM;

  try {
    const result = await sendNotification({
      channel: "email",
      target: "coach@example.com",
      message: "test",
    });
    assert.deepEqual(result, {
      ok: false,
      providerRef: null,
      error: "Missing email sender",
    });
  } finally {
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.EMAIL_NOTIFY_FROM;
    else process.env.EMAIL_NOTIFY_FROM = originalFrom;
  }
});
