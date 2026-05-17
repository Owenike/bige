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
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  const to = process.env.LINE_BOOKING_NOTIFY_TO || "";

  if (!token || !to) {
    console.info("LINE booking notification skipped: missing env");
    return { ok: true, skipped: true, error: "missing_env" };
  }

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
      console.warn("LINE booking notification failed", { status: response.status });
      return { ok: false, status: response.status, error: "line_push_failed" };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    console.warn("LINE booking notification failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return { ok: false, error: error instanceof Error ? error.message : "unknown_error" };
  }
}
