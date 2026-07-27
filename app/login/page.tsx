import { redirect } from "next/navigation";

type LegacyLoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LegacyLoginPage({ searchParams }: LegacyLoginPageProps) {
  const params = await searchParams;
  const tab = firstValue(params.tab);
  const destination = tab === "member" || tab === "activation" ? "/login/member" : "/login/staff";
  const nextParams = new URLSearchParams();

  for (const key of ["returnTo", "redirect", "next", "embed"] as const) {
    const value = firstValue(params[key]);
    if (value) nextParams.set(key, value);
  }
  if (tab === "activation") nextParams.set("tab", "activation");

  const query = nextParams.toString();
  redirect(query ? `${destination}?${query}` : destination);
}
