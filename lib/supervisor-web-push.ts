import webPush from "web-push";

export type SupervisorPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export function supervisorWebPushPublicKey() {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || "";
}

function configureWebPush() {
  const publicKey = supervisorWebPushPublicKey();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim() || "mailto:admin@bigefitness.com";
  if (!publicKey || !privateKey) {
    throw new Error("主管手機通知尚未完成設定");
  }
  webPush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendSupervisorLoginPush(input: {
  subscription: SupervisorPushSubscription;
  approvalUrl: string;
  employeeNumber: string;
  platform: string;
  browser: string;
}) {
  configureWebPush();
  try {
    const result = await webPush.sendNotification(
      input.subscription,
      JSON.stringify({
        title: "BIG E 主管登入確認",
        body: `${input.employeeNumber} 正在 ${input.platform} · ${input.browser} 要求登入，請確認是否為本人。`,
        url: input.approvalUrl,
        tag: `supervisor-login-${input.employeeNumber}`,
      }),
      { TTL: 120, urgency: "high" },
    );
    return { ok: true as const, statusCode: result.statusCode };
  } catch (error) {
    const failure = error as { statusCode?: number; message?: string };
    return {
      ok: false as const,
      statusCode: failure.statusCode || null,
      gone: failure.statusCode === 404 || failure.statusCode === 410,
      error: failure.message || "web_push_failed",
    };
  }
}
