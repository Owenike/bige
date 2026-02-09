import { cookies } from "next/headers";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  messages,
  type Locale,
  type MessageKey,
} from "./i18n";

export async function getLocaleFromCookies(): Promise<Locale> {
  // Next.js (15+) returns cookies() as an async API.
  const jar = await cookies();
  const c = jar.get(LOCALE_COOKIE)?.value;
  return c && isLocale(c) ? c : defaultLocale;
}

export function tServer(key: MessageKey, locale: Locale): string {
  const dict = messages[locale] as Record<string, string>;
  return dict[key] ?? key;
}

export async function getT() {
  const locale = await getLocaleFromCookies();
  return (key: MessageKey) => tServer(key, locale);
}
