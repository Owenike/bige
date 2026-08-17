export const AUTH_CAPABILITIES = [
  "student_checkin_admin",
  "trial_booking_admin",
] as const;

export type AuthCapability = (typeof AUTH_CAPABILITIES)[number];

const capabilitySet = new Set<string>(AUTH_CAPABILITIES);

function stringValues(value: unknown) {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function readAuthCapabilities(appMetadata: unknown): AuthCapability[] {
  if (!appMetadata || typeof appMetadata !== "object" || Array.isArray(appMetadata)) return [];

  const metadata = appMetadata as Record<string, unknown>;
  const values = [
    ...stringValues(metadata.account_area),
    ...stringValues(metadata.account_areas),
    ...stringValues(metadata.capabilities),
  ];

  return [...new Set(values)]
    .filter((value): value is AuthCapability => capabilitySet.has(value));
}

export function hasAuthCapability(appMetadata: unknown, capability: AuthCapability) {
  return readAuthCapabilities(appMetadata).includes(capability);
}
