import React from "react";
import Script from "next/script";
import "./globals.css";
import { I18nProvider } from "./i18n-provider";
import LayoutChrome from "./layout-chrome";
import { getLocaleFromCookies } from "../lib/i18n-server";

const GTM_ID = "GTM-588ZGDKH";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocaleFromCookies();
  return (
    <html lang={locale}>
      <head>
        <Script id="google-tag-manager" strategy="beforeInteractive">
          {`
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${GTM_ID}');
          `}
        </Script>
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans TC, sans-serif",
        }}
      >
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
            title="Google Tag Manager"
          />
        </noscript>
        <I18nProvider initialLocale={locale}>
          <LayoutChrome>{children}</LayoutChrome>
        </I18nProvider>
      </body>
    </html>
  );
}
