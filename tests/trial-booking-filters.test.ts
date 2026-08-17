import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingMatchesWorkflowGroup,
  bookingMatchesStatusFilter,
  parseTrialBookingWorkflowGroup,
  parseTrialBookingStatusFilter,
  parseTrialPaymentStatusFilter,
  paymentMatchesStatusFilter,
} from "../lib/trial-booking-filters";

test("workflow filter exposes only the two operational groups", () => {
  assert.equal(parseTrialBookingWorkflowGroup("follow_up"), "follow_up");
  assert.equal(parseTrialBookingWorkflowGroup("processed"), "processed");
  assert.equal(parseTrialBookingWorkflowGroup("scheduled"), "");
});

test("follow-up means no arrangement and no contact record", () => {
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "new", contactHistoryCount: 0 }, "follow_up"), true);
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "contacted", contactHistoryCount: 0 }, "follow_up"), true);
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "new", contactHistoryCount: 0, staffNote: "內部備註" }, "follow_up"), true);
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "new", contactHistoryCount: 1 }, "follow_up"), false);
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "scheduled", contactHistoryCount: 0 }, "follow_up"), false);
});

test("processed means arranged or carrying a contact record", () => {
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "new", contactHistoryCount: 1 }, "processed"), true);
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "new", appointmentDate: "2026-08-03" }, "processed"), true);
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "completed", contactHistoryCount: 0 }, "processed"), true);
  assert.equal(bookingMatchesWorkflowGroup({ bookingStatus: "cancelled", contactHistoryCount: 1 }, "processed"), false);
});

test("booking filters keep hidden records separate from payment filters", () => {
  assert.equal(parseTrialBookingStatusFilter("pending"), "pending");
  assert.equal(parseTrialBookingStatusFilter("cancelled"), "cancelled");
  assert.equal(parseTrialBookingStatusFilter("hidden_cancelled"), "");
  assert.equal(parseTrialPaymentStatusFilter("hidden_cancelled"), "");
});

test("the default booking view contains every non-hidden booking", () => {
  assert.equal(bookingMatchesStatusFilter("new", ""), true);
  assert.equal(bookingMatchesStatusFilter("scheduled", ""), true);
  assert.equal(bookingMatchesStatusFilter("completed", ""), true);
  assert.equal(bookingMatchesStatusFilter("cancelled", ""), false);
});

test("pending booking filter means new or contacted only", () => {
  assert.equal(bookingMatchesStatusFilter("new", "pending"), true);
  assert.equal(bookingMatchesStatusFilter("contacted", "pending"), true);
  assert.equal(bookingMatchesStatusFilter("scheduled", "pending"), false);
});

test("payment filters only compare payment state", () => {
  assert.equal(paymentMatchesStatusFilter("pending_cash", "pending_cash"), true);
  assert.equal(paymentMatchesStatusFilter("paid", "pending_cash"), false);
  assert.equal(paymentMatchesStatusFilter("paid", ""), true);
});
