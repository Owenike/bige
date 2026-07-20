export function normalizeStudentPhone(input: string) {
  const digits = input.normalize("NFKC").replace(/\D/g, "");

  let local = digits;
  if (local.startsWith("002886")) local = local.slice(6);
  else if (local.startsWith("00886")) local = local.slice(5);
  else if (local.startsWith("886")) local = local.slice(3);

  if (/^09\d{8}$/.test(local)) return local;
  if (/^9\d{8}$/.test(local)) return `0${local}`;
  return digits;
}
