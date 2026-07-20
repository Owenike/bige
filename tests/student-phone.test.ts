import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStudentPhone } from "../lib/student-phone";

test("keeps a canonical Taiwan mobile number", () => {
  assert.equal(normalizeStudentPhone("0912-345-678"), "0912345678");
});

test("normalizes Taiwan country-code mobile numbers", () => {
  assert.equal(normalizeStudentPhone("+886 912 345 678"), "0912345678");
  assert.equal(normalizeStudentPhone("+886 (0) 912-345-678"), "0912345678");
  assert.equal(normalizeStudentPhone("00886 912 345 678"), "0912345678");
  assert.equal(normalizeStudentPhone("002-886-912-345-678"), "0912345678");
});

test("restores the local leading zero when omitted", () => {
  assert.equal(normalizeStudentPhone("912345678"), "0912345678");
});

test("accepts full-width digits from mobile input methods", () => {
  assert.equal(normalizeStudentPhone("０９１２３４５６７８"), "0912345678");
});

test("does not guess at unrelated or malformed numbers", () => {
  assert.equal(normalizeStudentPhone("02-2345-6789"), "0223456789");
  assert.equal(normalizeStudentPhone("09811801111"), "09811801111");
});
