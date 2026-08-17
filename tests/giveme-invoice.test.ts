import assert from "node:assert/strict";
import test from "node:test";
import {
  GivemeInvoiceError,
  buildGivemeInvoiceItems,
  buildGivemeIssueRequest,
  createGivemeInvoiceSign,
  issueGivemeInvoice,
  readGivemeInvoiceConfig,
  type GivemeInvoiceConfig,
} from "../lib/integrations/giveme-invoice";

const config: GivemeInvoiceConfig = {
  enabled: true,
  mode: "test",
  apiRoot: "https://example.test/invoice.do",
  uncode: "12345678",
  idno: "ApiUser",
  password: "test-secret",
  timeoutMs: 1_000,
};

const now = new Date("2024-08-12T08:39:49.000Z");

test("creates the uppercase MD5 signature required by Giveme", () => {
  assert.equal(
    createGivemeInvoiceSign("1723456789000", "ApiUser", "test-secret"),
    "6005358BB55F4B9E54E8EAA447D0A66E",
  );
});

test("reads disabled server-only configuration by default", () => {
  const result = readGivemeInvoiceConfig({});
  assert.equal(result.enabled, false);
  assert.equal(result.mode, "test");
  assert.equal(result.apiRoot, "https://www.giveme.com.tw/invoice.do");
});

test("allocates the exact invoice total across order items", () => {
  assert.deepEqual(buildGivemeInvoiceItems(101, [
    { title: "Monthly plan", lineTotal: 50 },
    { title: "Training", lineTotal: 50 },
    { title: "Towel", lineTotal: 50 },
  ]), [
    { name: "Monthly plan", money: 34, number: 1 },
    { name: "Training", money: 34, number: 1 },
    { name: "Towel", money: 33, number: 1 },
  ]);
});

test("builds a B2C request with a mobile barcode carrier", () => {
  const result = buildGivemeIssueRequest({
    orderId: "order-123",
    totalFee: 1_000,
    customerName: "Test Customer",
    carrier: "/ABC+123",
    items: [{ title: "Fitness service", lineTotal: 1_000 }],
  }, config, now);

  assert.equal(result.kind, "B2C");
  assert.equal(result.action, "addB2C");
  assert.equal(result.request.phone, "/ABC+123");
  assert.equal(result.request.orderCode, "");
  assert.equal(result.request.totalFee, "1000");
  assert.equal(result.request.timeStamp, String(now.getTime()));
  assert.equal("password" in result.request, false);
});

test("uses the internal order reference when no B2C carrier is supplied", () => {
  const result = buildGivemeIssueRequest({
    orderId: "order-123",
    totalFee: 500,
  }, config, now);

  assert.equal(result.kind, "B2C");
  assert.equal(result.request.phone, "");
  assert.equal(result.request.orderCode, "BIGEORDER123");
});

test("builds a B2B request with tax-inclusive sales and tax amounts", () => {
  const result = buildGivemeIssueRequest({
    orderId: "order-123",
    totalFee: 1_050,
    taxId: "87654321",
  }, config, now);

  assert.equal(result.kind, "B2B");
  assert.equal(result.action, "addB2B");
  assert.equal(result.request.phone, "87654321");
  assert.equal(result.request.sales, "1000");
  assert.equal(result.request.amount, "50");
});

test("posts JSON to the Giveme action endpoint and normalizes success", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      success: "true",
      code: "AA12345678",
      msg: "ok",
      totalFee: "300",
    }), { status: 200 });
  }) as typeof fetch;

  const result = await issueGivemeInvoice({
    orderId: "order-123",
    totalFee: 300,
  }, { config, fetcher, now });

  assert.equal(capturedUrl, "https://example.test/invoice.do?action=addB2C");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(result.success, true);
  assert.equal(result.code, "AA12345678");
});

test("surfaces provider HTTP failures without exposing the password", async () => {
  const fetcher = (async () => new Response("provider error", { status: 503 })) as typeof fetch;

  await assert.rejects(
    issueGivemeInvoice({ orderId: "order-123", totalFee: 300 }, { config, fetcher, now }),
    (error: unknown) => {
      assert.ok(error instanceof GivemeInvoiceError);
      assert.equal(error.status, 503);
      assert.equal(error.message.includes(config.password), false);
      return true;
    },
  );
});
