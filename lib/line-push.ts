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

export type LineTrialBookingNotificationInput = {
  name: string;
  phone: string;
  birthday: string;
  lineName?: string | null;
  service: string;
  preferredTime: string;
  paymentMethod: string;
  paymentStatus?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  note?: string | null;
  submittedAt?: Date;
};

export type LineScheduledTrialBookingNotificationInput = {
  appointmentDate: string;
  appointmentTime: string;
  service: string;
  name: string;
  phone: string;
  bookingCoach: string;
  executingCoach: string;
  source: string;
  note?: string | null;
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

function buildTrialBookingNotificationText(input: LineTrialBookingNotificationInput) {
  const lines = [
    "BigE 新首次體驗預約",
    "",
    `姓名：${input.name}`,
    `電話：${input.phone}`,
    `生日：${input.birthday}`,
  ];

  const lineName = input.lineName?.trim();
  if (lineName) {
    lines.push(`LINE 名稱：${lineName}`);
  }

  lines.push(
    `體驗項目：${input.service}`,
    `方便時段：${input.preferredTime}`,
    `付款方式：${input.paymentMethod}`,
  );

  if (input.paymentStatus?.trim()) {
    lines.push(`付款狀態：${input.paymentStatus.trim()}`);
  }

  if (input.amount) {
    const currency = input.currency?.trim() || "TWD";
    lines.push(`金額：${currency} ${input.amount}`);
  }

  lines.push(
    `備註：${input.note?.trim() || "無"}`,
    `送出時間：${formatTaipeiDateTime(input.submittedAt || new Date())}`,
    "",
    "請協助聯繫確認實際體驗時段。",
  );

  return lines.join("\n");
}

function formatDisplayDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${Number(match[2])}/${Number(match[3])}`;
}

function buildScheduledTrialBookingNotificationText(input: LineScheduledTrialBookingNotificationInput) {
  return [
    "BigE 新增體驗預約",
    "",
    `預約日期：${formatDisplayDate(input.appointmentDate)}`,
    `預約時間：${input.appointmentTime}`,
    `預約項目：${input.service}`,
    `姓名：${input.name}`,
    `電話：${input.phone}`,
    `預約教練：${input.bookingCoach}`,
    `執行教練：${input.executingCoach}`,
    `來源：${input.source}`,
    `備註：${input.note?.trim() || ""}`,
  ].join("\n");
}

async function pushLineTextMessage(
  logPrefix: string,
  text: string,
): Promise<LineBookingNotificationResult> {
  const rawToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  const rawTarget = process.env.LINE_BOOKING_NOTIFY_TO || "";
  const token = rawToken.trim();
  const to = rawTarget.trim();
  const diagnostics = buildDiagnostics(rawToken, rawTarget);

  if (!token || !to) {
    console.info(`${logPrefix} line push skipped: missing env`, {
      hasToken: diagnostics.hasToken,
      hasTarget: diagnostics.hasTarget,
    });
    return { ok: true, skipped: true, error: "missing_env" };
  }

  console.info(`${logPrefix} line push start`);
  console.info(`${logPrefix} line push config`, diagnostics);

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
            text,
          },
        ],
      }),
    });

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, RESPONSE_BODY_LOG_LIMIT);
      console.warn(`${logPrefix} line push result`, {
        status: response.status,
        ok: false,
        statusText: response.statusText,
        responseBodyPreview: responseBody,
      });
      return { ok: false, status: response.status, error: "line_push_failed" };
    }

    console.info(`${logPrefix} line push result`, { status: response.status, ok: true });
    return { ok: true, status: response.status };
  } catch (error) {
    console.warn(`${logPrefix} line push failed`, {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return { ok: false, error: error instanceof Error ? error.message : "unknown_error" };
  }
}

export async function sendLineBookingNotification(
  input: LineBookingNotificationInput,
): Promise<LineBookingNotificationResult> {
  return pushLineTextMessage("[public-booking]", buildBookingNotificationText(input));
}

export async function sendLineTrialBookingNotification(
  input: LineTrialBookingNotificationInput,
): Promise<LineBookingNotificationResult> {
  return pushLineTextMessage("[trial-booking]", buildTrialBookingNotificationText(input));
}

export async function sendLineScheduledTrialBookingNotification(
  input: LineScheduledTrialBookingNotificationInput,
): Promise<LineBookingNotificationResult> {
  return pushLineTextMessage("[trial-booking-scheduled]", buildScheduledTrialBookingNotificationText(input));
}
