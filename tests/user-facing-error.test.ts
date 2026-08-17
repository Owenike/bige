import assert from "node:assert/strict";
import test from "node:test";
import {
  externalErrorLogContext,
  userFacingErrorMessage,
} from "../lib/user-facing-error";

const fallback = "資料暫時無法載入，系統會自動重試。";

test("user-facing errors keep short plain-text API messages", () => {
  assert.equal(userFacingErrorMessage("此帳號沒有報到管理權限。", fallback), "此帳號沒有報到管理權限。");
});

test("user-facing errors reject HTML responses and oversized upstream bodies", () => {
  const cloudflareHtml = "<!DOCTYPE html><html><head><title>supabase.co | 520</title></head><body>Error</body></html>";
  assert.equal(userFacingErrorMessage(cloudflareHtml, fallback), fallback);
  assert.equal(userFacingErrorMessage("x".repeat(181), fallback), fallback);
});

test("upstream log context records HTML without copying its body", () => {
  const cloudflareHtml = "<!DOCTYPE html><html><body>Web server is returning an unknown error</body></html>";
  const context = externalErrorLogContext({ message: cloudflareHtml, code: "520" });
  assert.equal(context.responseFormat, "html");
  assert.equal(context.code, "520");
  assert.equal(context.messagePreview, undefined);
  assert.doesNotMatch(JSON.stringify(context), /DOCTYPE|Web server/);
});
