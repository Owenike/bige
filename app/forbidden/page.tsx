import type { Metadata } from "next";
import ForbiddenContent from "./forbidden-content";

export const metadata: Metadata = {
  title: "無法存取 | BigE Fitness",
};

type ForbiddenPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ForbiddenPage({ searchParams }: ForbiddenPageProps) {
  const params = await searchParams;
  return <ForbiddenContent code={firstValue(params.code) ?? null} />;
}
