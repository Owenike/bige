import assert from "node:assert/strict";
import test from "node:test";
import {
  hasCurrentStudentDropInTermsAcceptance,
  isStudentDropInRegistrationComplete,
  STUDENT_DROP_IN_TERMS_VERSION,
  studentDropInActivityInterestLabel,
  studentDropInGenderLabel,
} from "../lib/student-drop-in-registration";

const completeRegistration = {
  invoice_carrier: "/ABCD123",
  gender: "female" as const,
  activity_interest: "reformer_pilates" as const,
  discovery_source: "Instagram",
  terms_version: STUDENT_DROP_IN_TERMS_VERSION,
  terms_accepted_at: "2026-08-11T08:00:00.000Z",
  registration_correction_required: false,
  correction_requested_at: null,
};

test("data correction can reuse the current accepted terms", () => {
  assert.equal(hasCurrentStudentDropInTermsAcceptance(completeRegistration), true);
  assert.equal(
    hasCurrentStudentDropInTermsAcceptance({ ...completeRegistration, terms_accepted_at: null }),
    false,
  );
  assert.equal(
    hasCurrentStudentDropInTermsAcceptance({ ...completeRegistration, terms_version: "2025-01-01" }),
    false,
  );
});

test("drop-in registration requires every page-one field and the current terms version", () => {
  assert.equal(isStudentDropInRegistrationComplete(completeRegistration), true);
  assert.equal(isStudentDropInRegistrationComplete({ ...completeRegistration, invoice_carrier: " " }), false);
  assert.equal(isStudentDropInRegistrationComplete({ ...completeRegistration, discovery_source: null }), false);
  assert.equal(isStudentDropInRegistrationComplete({ ...completeRegistration, terms_version: "2025-01-01" }), false);
  assert.equal(isStudentDropInRegistrationComplete({ ...completeRegistration, terms_accepted_at: null }), false);
  assert.equal(
    isStudentDropInRegistrationComplete({
      ...completeRegistration,
      registration_correction_required: true,
      correction_requested_at: "2026-08-12T01:00:00.000Z",
    }),
    false,
  );
});

test("drop-in registration values have stable staff-facing labels", () => {
  assert.equal(studentDropInGenderLabel("male"), "男");
  assert.equal(studentDropInGenderLabel("female"), "女");
  assert.match(studentDropInActivityInterestLabel("weight_training"), /重量訓練/);
  assert.match(studentDropInActivityInterestLabel("reformer_pilates"), /器械皮拉提斯/);
});
