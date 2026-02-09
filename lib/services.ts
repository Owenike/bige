export type BookableService = {
  code: string;
  name: string;
  durationMinutes: number;
  capacity: number;
};

export const DEFAULT_SERVICES: BookableService[] = [
  { code: "personal_training", name: "Personal Training", durationMinutes: 60, capacity: 1 },
];

export function findServiceByCode(code: string) {
  const trimmed = String(code || "").trim();
  return DEFAULT_SERVICES.find((s) => s.code === trimmed) || null;
}

