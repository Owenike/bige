import type { AcpayParsedXml } from "./acpay";

export type AcpayChecklistSnapshot = {
  authorizationRequestXml?: string;
  authorizationResponseXml?: string;
  codeUrl?: string;
  outTradeNo?: string;
  transactionId?: string;
  callbackQuery?: Record<string, string>;
  notifyRawXml?: string;
  notifyParsedPayload?: AcpayParsedXml;
  captureRequestXml?: string;
  captureResponseXml?: string;
  refundRequestXml?: string;
  refundResponseXml?: string;
  updatedAt?: string;
};

const globalForAcpay = globalThis as typeof globalThis & {
  __bigeAcpayChecklist?: AcpayChecklistSnapshot;
};

function snapshot() {
  if (!globalForAcpay.__bigeAcpayChecklist) {
    globalForAcpay.__bigeAcpayChecklist = {};
  }

  return globalForAcpay.__bigeAcpayChecklist;
}

export function recordAcpayChecklist(update: AcpayChecklistSnapshot) {
  const current = snapshot();
  Object.assign(current, update, { updatedAt: new Date().toISOString() });
  return current;
}

export function getAcpayChecklistSnapshot() {
  return { ...snapshot() };
}
