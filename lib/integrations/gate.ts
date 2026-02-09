export interface GateOpenInput {
  tenantId: string;
  storeId: string;
  memberId: string;
  checkinAt: string;
}

export interface GateOpenResult {
  attempted: boolean;
  opened: boolean;
  message: string;
}

export async function openGate(input: GateOpenInput): Promise<GateOpenResult> {
  const endpoint = process.env.GATE_CONTROLLER_ENDPOINT || "";
  const apiKey = process.env.GATE_CONTROLLER_API_KEY || "";

  if (!endpoint) {
    return { attempted: false, opened: false, message: "Gate endpoint not configured" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        tenantId: input.tenantId,
        storeId: input.storeId,
        memberId: input.memberId,
        checkinAt: input.checkinAt,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    const text = await response.text();
    if (!response.ok) {
      return { attempted: true, opened: false, message: text || `Gate HTTP ${response.status}` };
    }

    return { attempted: true, opened: true, message: text || "Gate opened" };
  } catch (error) {
    return {
      attempted: true,
      opened: false,
      message: error instanceof Error ? error.message : "Gate integration error",
    };
  }
}
