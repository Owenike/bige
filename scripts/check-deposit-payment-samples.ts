import fs from "node:fs";
import path from "node:path";
import {
  extractNewebpayWebhookPayload,
  normalizeNewebpayProviderStatus,
  resolveBookingDepositMirror,
  signNewebpayWebhookBody,
  verifyNewebpayWebhookSignature,
} from "../lib/newebpay-deposit-provider";

type SampleMeta = {
  currentPaymentStatus?: string;
  currentBookingPaymentStatus?: string;
  depositRequiredAmount?: number;
  depositPaidAmount?: number;
  finalAmount?: number;
  paymentAmount?: number;
  secret?: string;
};

type SampleShape = {
  name: string;
  payload: Record<string, unknown>;
  meta?: SampleMeta;
  rawBody?: string;
  signature?: string;
};

function readSample(filePath: string): SampleShape {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as SampleShape;
}

function compareSample(samplePath: string) {
  const sample = readSample(samplePath);
  const extracted = extractNewebpayWebhookPayload(sample.payload);
  const normalized = normalizeNewebpayProviderStatus(
    extracted.status,
    sample.meta?.currentPaymentStatus || "pending",
  );
  const mirror = resolveBookingDepositMirror({
    currentBookingPaymentStatus: sample.meta?.currentBookingPaymentStatus || "deposit_pending",
    depositRequiredAmount: sample.meta?.depositRequiredAmount ?? 1000,
    depositPaidAmount: sample.meta?.depositPaidAmount ?? 0,
    finalAmount: sample.meta?.finalAmount ?? 3000,
    paymentAmount: sample.meta?.paymentAmount ?? 1000,
    paymentStatus: normalized.paymentStatus,
    gatewayRef: extracted.gatewayRef,
    paymentId: extracted.paymentId,
  });
  const missingFields = [
    extracted.canonicalFields.paymentId === "missing" ? "paymentId" : null,
    extracted.canonicalFields.orderId === "missing" ? "orderId" : null,
    extracted.canonicalFields.status === "missing" ? "status" : null,
  ].filter(Boolean) as string[];
  const rawBody = sample.rawBody || JSON.stringify(sample.payload);
  const signature =
    sample.signature ||
    (sample.meta?.secret ? signNewebpayWebhookBody(rawBody, sample.meta.secret) : null);
  const signatureResult = sample.meta?.secret
    ? verifyNewebpayWebhookSignature(rawBody, signature || "", sample.meta.secret)
    : null;
  const decision = normalized.ignoredStatusRegression
    ? "ignored_regression"
    : mirror.duplicate
      ? "duplicate"
      : missingFields.length
        ? "accepted_with_missing_fields"
        : "applied";

  console.log(`sample ${sample.name}`);
  console.log(`  file: ${samplePath}`);
  console.log(`  paymentId source: ${extracted.canonicalFields.paymentId}`);
  console.log(`  orderId source: ${extracted.canonicalFields.orderId}`);
  console.log(`  status source: ${extracted.canonicalFields.status}`);
  console.log(`  gatewayRef source: ${extracted.canonicalFields.gatewayRef}`);
  console.log(`  merchantTradeNo source: ${extracted.canonicalFields.merchantTradeNo}`);
  console.log(`  normalized provider status: ${normalized.providerStatus}`);
  console.log(`  payments.status -> ${normalized.ignoredStatusRegression ? "paid (ignored regression)" : normalized.paymentStatus}`);
  console.log(`  orders.status -> ${normalized.ignoredStatusRegression ? "paid (kept)" : normalized.orderStatus}`);
  console.log(`  bookings.payment_status -> ${mirror.nextBookingPaymentStatus}`);
  console.log(`  bookings.deposit_paid_amount -> ${mirror.nextDepositPaidAmount}`);
  console.log(`  payment_reference/provider_reference -> ${mirror.nextPaymentReference || "-"}`);
  console.log(`  duplicate/ignored -> ${normalized.ignoredStatusRegression || mirror.duplicate ? "yes" : "no"}`);
  console.log(`  decision -> ${decision}`);
  console.log(`  missing canonical fields -> ${missingFields.length ? missingFields.join(", ") : "none"}`);
  console.log(
    `  signature -> ${
      signatureResult === null ? "not provided" : signatureResult ? "valid" : "invalid"
    }`,
  );
}

const argSamplePath = process.argv[2];
const root = process.cwd();
const defaultSamples = [
  path.join(root, "scripts", "fixtures", "newebpay", "live-success.json"),
  path.join(root, "scripts", "fixtures", "newebpay", "live-regression.json"),
];

const samples = argSamplePath ? [path.resolve(argSamplePath)] : defaultSamples;

for (const samplePath of samples) {
  compareSample(samplePath);
}

console.log("deposit-payment-samples:ok");
