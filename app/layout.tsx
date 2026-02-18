import React from "react";
import "./globals.css";
import { I18nProvider } from "./i18n-provider";
import LayoutChrome from "./layout-chrome";
import { getLocaleFromCookies } from "../lib/i18n-server";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocaleFromCookies();
  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans TC, sans-serif",
        }}
      >
        <I18nProvider initialLocale={locale}>
          <LayoutChrome>{children}</LayoutChrome>
        </I18nProvider>
      </body>
    </html>
  );
}
