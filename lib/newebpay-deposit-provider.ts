import crypto from "node:crypto";

export type BookingDepositPaymentStatus = "pending" | "paid" | "failed" | "voided" | "refunded";

export type NewebpayNormalizedStatus = {
  providerStatus: string;
  paymentStatus: BookingDepositPaymentStatus;
  orderStatus: "confirmed" | "paid";
  ignoredStatusRegression: boolean;
};

export type NewebpayExtractedPayload = {
  paymentId: string;
  orderId: string;
  status: string;
  gatewayRef: string | null;
  merchantTradeNo: string | null;
  raw: Record<string, unknown>;
  canonicalFields: {
    paymentId: "paymentId" | "payment_id" | "result.paymentId" | "missing";
    orderId: "orderId" | "order_id" | "merchantTradeNo" | "result.orderId" | "missing";
    status: "status" | "tradeStatus" | "paymentStatus" | "Status" | "result.status" | "missing";
    gatewayRef:
      | "gatewayRef"
      | "tradeNo"
      | "TradeNo"
      | "transactionId"
      | "result.gatewayRef"
      | "result.tradeNo"
      | "missing";
    merchantTradeNo: "merchantTradeNo" | "MerchantTradeNo" | "result.merchantTradeNo" | "missing";
  };
};

export type BookingDepositMirrorResolution = {
  nextBookingPaymentStatus: string;
  nextDepositPaidAmount: number;
  nextOutstandingAmount: number;
  nextPaymentReference: string | null;
  shouldStampDepositPaidAt: boolean;
  isPaidTransition: boolean;
  duplicate: boolean;
};

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function firstString(
  entries: Array<{ key: string; value: unknown }>,
  allowed: string[],
) {
  const hit = entries.find(
    (entry) =>
      allowed.includes(entry.key) &&
      typeof entry.value === "string" &&
      entry.value.trim().length > 0,
  );
  return {
    key: hit?.key || "missing",
    value: typeof hit?.value === "string" ? hit.value : "",
  };
}

export function signNewebpayWebhookBody(rawBody: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyNewebpayWebhookSignature(rawBody: string, signature: string, secret: string) {
  if (!signature || !secret) return false;
  const left = Buffer.from(signNewebpayWebhookBody(rawBody, secret), "utf8");
  const right = Buffer.from(signature, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function extractNewebpayWebhookPayload(
  payload: Record<string, unknown> | null | undefined,
): NewebpayExtractedPayload {
  const body = payload || {};
  const nestedResult =
    body.result && typeof body.result === "object"
      ? (body.result as Record<string, unknown>)
      : null;

  const paymentId = firstString(
    [
      { key: "paymentId", value: body.paymentId },
      { key: "payment_id", value: body.payment_id },
      { key: "result.paymentId", value: nestedResult?.paymentId },
    ],
    ["paymentId", "payment_id", "result.paymentId"],
  );
  const orderId = firstString(
    [
      { key: "orderId", value: body.orderId },
      { key: "order_id", value: body.order_id },
      { key: "merchantTradeNo", value: body.merchantTradeNo },
      { key: "merchantTradeNo", value: body.MerchantTradeNo },
      { key: "result.orderId", value: nestedResult?.orderId },
    ],
    ["orderId", "order_id", "merchantTradeNo", "result.orderId"],
  );
  const status = firstString(
    [
      { key: "status", value: body.status },
      { key: "tradeStatus", value: body.tradeStatus },
      { key: "paymentStatus", value: body.paymentStatus },
      { key: "Status", value: body.Status },
      { key: "result.status", value: nestedResult?.status },
    ],
    ["status", "tradeStatus", "paymentStatus", "Status", "result.status"],
  );
  const gatewayRef = firstString(
    [
      { key: "gatewayRef", value: body.gatewayRef },
      { key: "tradeNo", value: body.tradeNo },
      { key: "TradeNo", value: body.TradeNo },
      { key: "transactionId", value: body.transactionId },
      { key: "result.gatewayRef", value: nestedResult?.gatewayRef },
      { key: "result.tradeNo", value: nestedResult?.tradeNo },
    ],
    [
      "gatewayRef",
      "tradeNo",
      "TradeNo",
      "transactionId",
      "result.gatewayRef",
      "result.tradeNo",
    ],
  );
  const merchantTradeNo = firstString(
    [
      { key: "merchantTradeNo", value: body.merchantTradeNo },
      { key: "MerchantTradeNo", value: body.MerchantTradeNo },
      { key: "result.merchantTradeNo", value: nestedResult?.merchantTradeNo },
    ],
    ["merchantTradeNo", "MerchantTradeNo", "result.merchantTradeNo"],
  );

  return {
    paymentId: paymentId.value,
    orderId: orderId.value,
    status: status.value,
    gatewayRef: gatewayRef.value || null,
    merchantTradeNo: merchantTradeNo.value || null,
    raw: body,
    canonicalFields: {
      paymentId: paymentId.key as NewebpayExtractedPayload["canonicalFields"]["paymentId"],
      orderId: orderId.key as NewebpayExtractedPayload["canonicalFields"]["orderId"],
      status: status.key as NewebpayExtractedPayload["canonicalFields"]["status"],
      gatewayRef: gatewayRef.key as NewebpayExtractedPayload["canonicalFields"]["gatewayRef"],
      merchantTradeNo:
        merchantTradeNo.key as NewebpayExtractedPayload["canonicalFields"]["merchantTradeNo"],
    },
  };
}

export function normalizeNewebpayProviderStatus(
  input: string | null | undefined,
  currentPaymentStatus?: string | null,
): NewebpayNormalizedStatus {
  const raw = String(input || "").trim().toLowerCase();
  let mapped: Omit<NewebpayNormalizedStatus, "ignoredStatusRegression">;

  if (!raw) {
    mapped = {
      providerStatus: "pending",
      paymentStatus: "pending",
      orderStatus: "confirmed",
    };
  } else if (["paid", "success", "succeeded", "settled", "authorized"].includes(raw)) {
    mapped = {
      providerStatus: raw,
      paymentStatus: "paid",
      orderStatus: "paid",
    };
  } else if (["failed", "fail", "declined", "error"].includes(raw)) {
    mapped = {
      providerStatus: raw,
      paymentStatus: "failed",
      orderStatus: "confirmed",
    };
  } else if (["cancelled", "canceled", "voided", "void", "expired", "timeout", "timed_out"].includes(raw)) {
    mapped = {
      providerStatus: raw,
      paymentStatus: "voided",
      orderStatus: "confirmed",
    };
  } else {
    mapped = {
      providerStatus: raw,
      paymentStatus: "pending",
      orderStatus: "confirmed",
    };
  }

  const ignoredStatusRegression =
    String(currentPaymentStatus || "").trim().toLowerCase() === "paid" &&
    mapped.paymentStatus !== "paid";

  return {
    ...mapped,
    ignoredStatusRegression,
  };
}

export function resolveBookingDepositMirror(params: {
  currentBookingPaymentStatus: string | null | undefined;
  depositRequiredAmount: number | string | null | undefined;
  depositPaidAmount: number | string | null | undefined;
  finalAmount: number | string | null | undefined;
  paymentAmount: number | string | null | undefined;
  paymentStatus: BookingDepositPaymentStatus;
  gatewayRef: string | null | undefined;
  paymentId: string | null | undefined;
}) {
  const previousPaymentStatus = String(params.currentBookingPaymentStatus || "unpaid");
  const nextPaidAmount = Math.max(
    toNumber(params.depositPaidAmount),
    toNumber(params.paymentAmount),
  );
  const requiredAmount = toNumber(params.depositRequiredAmount);
  const finalAmount = toNumber(params.finalAmount);
  const isPaidTransition =
    params.paymentStatus === "paid" &&
    previousPaymentStatus !== "deposit_paid" &&
    previousPaymentStatus !== "fully_paid";

  if (params.paymentStatus !== "paid") {
    return {
      nextBookingPaymentStatus: previousPaymentStatus,
      nextDepositPaidAmount: toNumber(params.depositPaidAmount),
      nextOutstandingAmount: Math.max(0, finalAmount - toNumber(params.depositPaidAmount)),
      nextPaymentReference: params.gatewayRef || params.paymentId || null,
      shouldStampDepositPaidAt: false,
      isPaidTransition: false,
      duplicate: false,
    } satisfies BookingDepositMirrorResolution;
  }

  const nextBookingPaymentStatus =
    finalAmount > 0 && nextPaidAmount >= finalAmount
      ? "fully_paid"
      : nextPaidAmount >= requiredAmount && requiredAmount > 0
        ? "deposit_paid"
        : previousPaymentStatus;

  return {
    nextBookingPaymentStatus,
    nextDepositPaidAmount: nextPaidAmount,
    nextOutstandingAmount: Math.max(0, finalAmount - nextPaidAmount),
    nextPaymentReference: params.gatewayRef || params.paymentId || null,
    shouldStampDepositPaidAt: true,
    isPaidTransition,
    duplicate: !isPaidTransition,
  } satisfies BookingDepositMirrorResolution;
}
