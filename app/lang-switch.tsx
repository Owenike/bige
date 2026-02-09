"use client";

import React from "react";
import { locales } from "../lib/i18n";
import { useI18n } from "./i18n-provider";

export default function LangSwitch() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="pill" style={{ padding: 0, overflow: "hidden" }}>
      {locales.map((l) => {
        const active = l === locale;
        const label = l === "zh-Hant" ? t("lang.zh") : t("lang.en");

        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            className="btn"
            style={{
              border: "none",
              borderRadius: 0,
              boxShadow: "none",
              background: active ? "rgba(255,255,255,.95)" : "transparent",
              padding: "9px 10px",
              fontSize: 13,
              fontWeight: active ? 700 : 500,
            }}
            aria-pressed={active}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

