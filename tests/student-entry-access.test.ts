import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyStudentEntryAccess,
  matchFormalMemberIdentity,
  studentEntryAccessDatabaseCode,
  studentEntryAccessPublicError,
} from "../lib/student-entry-access";

test("an internal block always wins without exposing the internal reason", () => {
  for (const mode of ["autonomous", "drop_in"] as const) {
    const code = classifyStudentEntryAccess({
      mode,
      isBlocked: true,
      isFormalMember: true,
      autonomousEnabled: true,
    });
    assert.equal(code, "account_unavailable");
    assert.deepEqual(studentEntryAccessPublicError(code), {
      code: "account_unavailable",
      error: "帳號狀態異常，請洽現場人員協助確認。",
    });
  }
});

test("non-members are redirected away from autonomous training but can use NT$50 entry", () => {
  const input = { isBlocked: false, isFormalMember: false, autonomousEnabled: true };
  assert.equal(classifyStudentEntryAccess({ ...input, mode: "autonomous" }), "not_official_member");
  assert.equal(classifyStudentEntryAccess({ ...input, mode: "drop_in" }), "allowed");
});

test("formal members retain autonomous access without requiring an active coaching contract", () => {
  assert.equal(
    classifyStudentEntryAccess({
      mode: "autonomous",
      isBlocked: false,
      isFormalMember: true,
      autonomousEnabled: true,
    }),
    "allowed",
  );
});

test("identity matching is deterministic and prioritizes phone", () => {
  const members = [
    {
      id: "member-phone",
      full_name: "同名學員",
      phone: "0912-345-678",
      phone_normalized: "0912345678",
      email: "phone@example.com",
      birth_date: "1990-01-01",
    },
    {
      id: "member-name",
      full_name: "同名學員",
      phone: "0987654321",
      phone_normalized: "0987654321",
      email: "name@example.com",
      birth_date: "1990-01-01",
    },
  ];
  assert.deepEqual(
    matchFormalMemberIdentity(members, {
      fullName: "同名學員",
      phone: "0912345678",
      email: "different@example.com",
      birthDate: "1990-01-01",
    }),
    { memberId: "member-phone", matchMethod: "phone" },
  );
});

test("ambiguous identity does not grant formal-member access", () => {
  const members = ["member-1", "member-2"].map((id) => ({
    id,
    full_name: "重複姓名",
    phone: null,
    phone_normalized: null,
    email: null,
    birth_date: null,
  }));
  assert.equal(
    matchFormalMemberIdentity(members, {
      fullName: "重複姓名",
      phone: "0900000000",
      email: null,
      birthDate: null,
    }),
    null,
  );
});

test("database guard errors are mapped to stable public codes", () => {
  assert.equal(studentEntryAccessDatabaseCode(new Error("STUDENT_ENTRY_BLOCKED")), "account_unavailable");
  assert.equal(studentEntryAccessDatabaseCode(new Error("STUDENT_NOT_OFFICIAL_MEMBER")), "not_official_member");
  assert.equal(studentEntryAccessDatabaseCode(new Error("raw backend failure")), null);
});
