import assert from "node:assert/strict";
import test from "node:test";
import { collectResendDeliveryDiagnostics } from "../lib/resend-delivery-diagnostics";

test("Resend diagnostics report Apple-domain events without exposing recipient addresses", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/emails")) {
      return new Response(JSON.stringify({
        data: [
          { to: ["member@icloud.com"], created_at: "2026-08-16T00:00:00Z", last_event: "delivered" },
          { to: ["other@gmail.com"], created_at: "2026-08-16T00:01:00Z", last_event: "delivered" },
          { to: ["legacy@me.com"], created_at: "2026-08-16T00:02:00Z", last_event: "bounced" },
        ],
        has_more: false,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      data: [{
        name: "bigefitness.com",
        status: "verified",
        region: "ap-northeast-1",
        capabilities: { sending: "enabled", receiving: "disabled" },
      }],
    }), { status: 200 });
  }) as typeof fetch;

  const diagnostics = await collectResendDeliveryDiagnostics({
    apiKey: "re_test",
    configuredFrom: "BIG E FITNESS <hello@bigefitness.com>",
    fetchImpl,
  });

  assert.equal(diagnostics.configuredSenderDomain, "bigefitness.com");
  assert.equal(diagnostics.apiAccess.emails.available, true);
  assert.equal(diagnostics.apiAccess.domains.available, true);
  assert.equal(diagnostics.recentEmailCount, 3);
  assert.equal(diagnostics.recentAppleEmailCount, 2);
  assert.deepEqual(diagnostics.appleEventCounts, { bounced: 1, delivered: 1 });
  assert.deepEqual(diagnostics.recentAppleEmails[0]?.recipientDomains, ["icloud.com"]);
  assert.equal(diagnostics.domains[0]?.status, "verified");
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /member@icloud\.com|legacy@me\.com|other@gmail\.com/);
});

test("Resend diagnostics explain send-only API keys without failing the endpoint", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    message: "This API key is restricted to only send emails",
  }), { status: 401 })) as typeof fetch;

  const diagnostics = await collectResendDeliveryDiagnostics({
    apiKey: "re_send_only",
    configuredFrom: "BIG E FITNESS <hello@bigefitness.com>",
    fetchImpl,
  });

  assert.equal(diagnostics.apiAccess.emails.available, false);
  assert.equal(diagnostics.apiAccess.domains.available, false);
  assert.match(diagnostics.apiAccess.emails.error || "", /restricted to only send emails/);
  assert.equal(diagnostics.recentEmailCount, 0);
  assert.equal(diagnostics.recentAppleEmailCount, 0);
});
