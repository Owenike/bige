"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  Locale,
  messages,
  type MessageKey,
} from "../lib/i18n";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(^|;\\s*)" + name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "=([^;]*)"),
  );
  return m ? decodeURIComponent(m[2]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  // 400 days; long enough to feel "sticky"
  const maxAge = 60 * 60 * 24 * 400;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (initialLocale) return initialLocale;
    const fromCookie = readCookie(LOCALE_COOKIE);
    return fromCookie && isLocale(fromCookie) ? fromCookie : defaultLocale;
  });

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      writeCookie(LOCALE_COOKIE, next);
      // Re-render any server components that depend on locale later on.
      router.refresh();
    },
    [router],
  );

  const t = useCallback(
    (key: MessageKey) => {
      const dict = messages[locale];
      return (dict as Record<string, string>)[key] ?? key;
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}

