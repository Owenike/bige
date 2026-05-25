import type { AcpayParsedXml } from "./acpay";

export type AcpayChecklistSnapshot = {
  authorizationRequestXml?: string;
  authorizationResponseXml?: string;
  codeUrl?: string;
  outTradeNo?: string;
  transactionId?: string;
  callbackQuery?: Record<string, string>;
  notifyXml?: string;
  notifyRawXml?: string;
  notifyParsedPayload?: AcpayParsedXml;
  captureRequestXml?: string;
  captureResponseXml?: string;
  refundRequestXml?: string;
  refundResponseXml?: string;
  updatedAt?: string;
};

type AcpayChecklistStore = AcpayChecklistSnapshot & {
  byOutTradeNo?: Record<string, AcpayChecklistSnapshot>;
};

const globalForAcpay = globalThis as typeof globalThis & {
  __bigeAcpayChecklist?: AcpayChecklistStore;
};

function snapshot() {
  if (!globalForAcpay.__bigeAcpayChecklist) {
    globalForAcpay.__bigeAcpayChecklist = {};
  }

  return globalForAcpay.__bigeAcpayChecklist;
}

function getSnapshotOutTradeNo(update: AcpayChecklistSnapshot) {
  return update.outTradeNo || update.notifyParsedPayload?.out_trade_no || update.callbackQuery?.out_trade_no || "";
}

export function recordAcpayChecklist(update: AcpayChecklistSnapshot) {
  const current = snapshot();
  const updatedAt = new Date().toISOString();
  const nextUpdate = {
    ...update,
    notifyXml: update.notifyXml || update.notifyRawXml,
    updatedAt,
  };
  Object.assign(current, nextUpdate);

  const outTradeNo = getSnapshotOutTradeNo(update);
  if (outTradeNo) {
    current.byOutTradeNo = current.byOutTradeNo || {};
    current.byOutTradeNo[outTradeNo] = {
      ...(current.byOutTradeNo[outTradeNo] || {}),
      ...nextUpdate,
      outTradeNo,
    };
  }

  return current;
}

export function getAcpayChecklistSnapshot(outTradeNo?: string) {
  const current = snapshot();
  if (outTradeNo) {
    return {
      ...(current.byOutTradeNo?.[outTradeNo] || {}),
    };
  }

  return {
    ...current,
    byOutTradeNo: current.byOutTradeNo ? { ...current.byOutTradeNo } : undefined,
  };
}
