export type LineBookingNotificationInput = {
  customerName: string;
  customerGender: string;
  customerPhone: string;
  customerBirthdate: string;
  preferredDayType: string;
  preferredTimeSlot: string;
  note?: string | null;
  submittedAt?: Date;
};

export type LineBookingNotificationResult = {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
};

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const RESPONSE_BODY_LOG_LIMIT = 300;

function formatTaipeiDateTime(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);

  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function hasWhitespaceEdge(value: string) {
  return value.length > 0 && value !== value.trim();
}

function targetPrefix(value: string) {
  return value.trim().slice(0, 1) || "unknown";
}

function buildDiagnostics(rawToken: string, rawTarget: string) {
  const token = rawToken.trim();
  const target = rawTarget.trim();

  return {
    hasToken: token.length > 0,
    tokenLength: token.length,
    tokenHasBearerPrefix: token.toLowerCase().startsWith("bearer "),
    tokenHasWhitespaceEdge: hasWhitespaceEdge(rawToken),
    hasTarget: target.length > 0,
    targetPrefix: targetPrefix(rawTarget),
    targetLength: target.length,
  };
}

function buildBookingNotificationText(input: LineBookingNotificationInput) {
  return [
    "【公開預約需求】",
    "",
    `姓名：${input.customerName}`,
    `性別：${input.customerGender}`,
    `手機號碼：${input.customerPhone}`,
    `出生年月日：${input.customerBirthdate}`,
    `可預約日期：${input.preferredDayType}`,
    `可預約時段：${input.preferredTimeSlot}`,
    `備註：${input.note?.trim() || "無"}`,
    `送出時間：${formatTaipeiDateTime(input.submittedAt || new Date())}`,
    "",
    "請盡快聯繫確認實際預約時間。",
  ].join("\n");
}

export async function sendLineBookingNotification(
  input: LineBookingNotificationInput,
): Promise<LineBookingNotificationResult> {
  const rawToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  const rawTarget = process.env.LINE_BOOKING_NOTIFY_TO || "";
  const token = rawToken.trim();
  const to = rawTarget.trim();
  const diagnostics = buildDiagnostics(rawToken, rawTarget);

  if (!token || !to) {
    console.info("LINE booking notification skipped: missing env", {
      hasToken: diagnostics.hasToken,
      hasTarget: diagnostics.hasTarget,
    });
    return { ok: true, skipped: true, error: "missing_env" };
  }

  console.info("LINE booking notification attempting", diagnostics);

  try {
    const response = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        messages: [
          {
            type: "text",
            text: buildBookingNotificationText(input),
          },
        ],
      }),
    });

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, RESPONSE_BODY_LOG_LIMIT);
      console.warn("LINE booking notification failed", {
        status: response.status,
        statusText: response.statusText,
        responseBody,
      });
      return { ok: false, status: response.status, error: "line_push_failed" };
    }

    console.info("LINE booking notification sent", { status: response.status });
    return { ok: true, status: response.status };
  } catch (error) {
    console.warn("LINE booking notification failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return { ok: false, error: error instanceof Error ? error.message : "unknown_error" };
  }
}
