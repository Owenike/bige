export function getAcpayServerConfig() {
  const acpayEnv = process.env.ACPAY_ENV?.trim() || "";
  const merchantNo = process.env.ACPAY_MERCHANT_NO?.trim() || "";
  const secretKey = process.env.ACPAY_SECRET_KEY?.trim() || "";
  const apiRoot = process.env.ACPAY_API_ROOT?.trim() || "";
  const apiRoot2 = process.env.ACPAY_API_ROOT2?.trim() || "";
  const appBaseUrl = (process.env.APP_BASE_URL?.trim() || "").replace(/\/+$/, "");
  const trialAmount = process.env.ACPAY_TRIAL_AMOUNT?.trim() || "";
  const testActionToken = process.env.ACPAY_TEST_ACTION_TOKEN?.trim() || "";
  const envAmount = Number(trialAmount || 880);

  return {
    acpayEnv,
    merchantNo,
    secretKey,
    apiRoot,
    apiRoot2,
    appBaseUrl,
    trialAmount,
    testActionToken,
    envAmount,
  };
}

export function getAcpayConfigSummary(config: ReturnType<typeof getAcpayServerConfig>) {
  return {
    hasAcpayEnv: Boolean(config.acpayEnv),
    acpayEnv: config.acpayEnv || null,
    hasMerchantNo: Boolean(config.merchantNo),
    hasSecretKey: Boolean(config.secretKey),
    secretKeyLength: config.secretKey.length,
    hasApiRoot: Boolean(config.apiRoot),
    hasApiRoot2: Boolean(config.apiRoot2),
    hasAppBaseUrl: Boolean(config.appBaseUrl),
    hasTrialAmount: Boolean(config.trialAmount),
    hasTestActionToken: Boolean(config.testActionToken),
    apiRoot: config.apiRoot || null,
    apiRoot2: config.apiRoot2 || null,
    appBaseUrl: config.appBaseUrl || null,
  };
}

export function isAuthorizedAcpayTestRequest(request: Request, token: string) {
  const headerToken = request.headers.get("x-acpay-test-token")?.trim() || "";
  return Boolean(token) && headerToken === token;
}
