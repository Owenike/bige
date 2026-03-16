import {
  extractNewebpayWebhookPayload,
  normalizeNewebpayProviderStatus,
  resolveBookingDepositMirror,
  signNewebpayWebhookBody,
  verifyNewebpayWebhookSignature,
} from "../lib/newebpay-deposit-provider";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function logOk(label: string) {
  console.log(`ok ${label}`);
}

const rawBody = JSON.stringify({
  paymentId: "pay_success",
  orderId: "order_success",
  status: "paid",
  gatewayRef: "gw_success",
});
const secret = "fixture-secret";
const signature = signNewebpayWebhookBody(rawBody, secret);

assert(verifyNewebpayWebhookSignature(rawBody, signature, secret), "signature should verify");
assert(!verifyNewebpayWebhookSignature(rawBody, "bad-signature", secret), "bad signature should fail");
logOk("signature verification");

const successPayload = extractNewebpayWebhookPayload({
  paymentId: "pay_success",
  orderId: "order_success",
  status: "paid",
  gatewayRef: "gw_success",
});
const successTransition = normalizeNewebpayProviderStatus(successPayload.status, "pending");
const successMirror = resolveBookingDepositMirror({
  currentBookingPaymentStatus: "deposit_pending",
  depositRequiredAmount: 1000,
  depositPaidAmount: 0,
  finalAmount: 3000,
  paymentAmount: 1000,
  paymentStatus: successTransition.paymentStatus,
  gatewayRef: successPayload.gatewayRef,
  paymentId: successPayload.paymentId,
});
assert(successPayload.canonicalFields.paymentId === "paymentId", "success paymentId canonical source");
assert(successTransition.paymentStatus === "paid", "success should map to paid payment");
assert(successTransition.orderStatus === "paid", "success should map to paid order");
assert(successMirror.nextBookingPaymentStatus === "deposit_paid", "success should mark deposit_paid");
assert(successMirror.nextDepositPaidAmount === 1000, "success should stamp deposit amount");
assert(successMirror.nextPaymentReference === "gw_success", "success should prefer gateway ref");
logOk("success fixture");

const failedPayload = extractNewebpayWebhookPayload({
  payment_id: "pay_failed",
  order_id: "order_failed",
  tradeStatus: "failed",
  tradeNo: "gw_failed",
});
const failedTransition = normalizeNewebpayProviderStatus(failedPayload.status, "pending");
const failedMirror = resolveBookingDepositMirror({
  currentBookingPaymentStatus: "deposit_pending",
  depositRequiredAmount: 1000,
  depositPaidAmount: 0,
  finalAmount: 3000,
  paymentAmount: 1000,
  paymentStatus: failedTransition.paymentStatus,
  gatewayRef: failedPayload.gatewayRef,
  paymentId: failedPayload.paymentId,
});
assert(failedPayload.canonicalFields.status === "tradeStatus", "failed status canonical source");
assert(failedTransition.paymentStatus === "failed", "failed should map to failed payment");
assert(failedTransition.orderStatus === "confirmed", "failed should keep order confirmed");
assert(failedMirror.nextBookingPaymentStatus === "deposit_pending", "failed should not mark paid");
logOk("failed fixture");

const voidPayload = extractNewebpayWebhookPayload({
  result: {
    paymentId: "pay_timeout",
    orderId: "order_timeout",
    status: "timeout",
    tradeNo: "gw_timeout",
  },
});
const voidTransition = normalizeNewebpayProviderStatus(voidPayload.status, "pending");
assert(voidPayload.canonicalFields.paymentId === "result.paymentId", "nested paymentId canonical source");
assert(voidTransition.paymentStatus === "voided", "timeout should map to voided");
assert(voidTransition.orderStatus === "confirmed", "timeout should not mark order paid");
logOk("void fixture");

const duplicateRegression = normalizeNewebpayProviderStatus("failed", "paid");
const duplicateMirror = resolveBookingDepositMirror({
  currentBookingPaymentStatus: "deposit_paid",
  depositRequiredAmount: 1000,
  depositPaidAmount: 1000,
  finalAmount: 3000,
  paymentAmount: 1000,
  paymentStatus: "paid",
  gatewayRef: "gw_paid",
  paymentId: "pay_paid",
});
assert(duplicateRegression.ignoredStatusRegression, "paid->failed callback should be ignored as regression");
assert(duplicateMirror.nextBookingPaymentStatus === "deposit_paid", "duplicate paid should not downgrade booking");
assert(duplicateMirror.duplicate, "duplicate paid should be marked duplicate");
logOk("status regression fixture");

const repeatedPaid = normalizeNewebpayProviderStatus("paid", "paid");
const repeatedPaidMirror = resolveBookingDepositMirror({
  currentBookingPaymentStatus: "deposit_paid",
  depositRequiredAmount: 1000,
  depositPaidAmount: 1000,
  finalAmount: 3000,
  paymentAmount: 1000,
  paymentStatus: repeatedPaid.paymentStatus,
  gatewayRef: "gw_paid_repeat",
  paymentId: "pay_paid_repeat",
});
assert(repeatedPaid.paymentStatus === "paid", "repeated paid should remain paid");
assert(repeatedPaidMirror.nextDepositPaidAmount === 1000, "repeated paid should not overcount amount");
assert(repeatedPaidMirror.duplicate, "repeated paid should be duplicate");
logOk("duplicate paid fixture");

const malformedPayload = extractNewebpayWebhookPayload({
  MerchantTradeNo: "merchant_only",
  Status: "paid",
});
assert(malformedPayload.paymentId === "", "missing paymentId should remain empty");
assert(malformedPayload.orderId === "merchant_only", "merchantTradeNo fallback should populate orderId");
assert(malformedPayload.canonicalFields.paymentId === "missing", "malformed payload should expose missing paymentId");
logOk("malformed payload fixture");

console.log("deposit-payment-fixtures:ok");
