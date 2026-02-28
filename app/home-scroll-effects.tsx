"use client";

import { useEffect } from "react";

export default function HomeScrollEffects() {
  useEffect(() => {
    const section = document.querySelector<HTMLElement>("[data-scroll-fade='dark-to-light']");
    if (!section) return;

    let rafId = 0;
    const update = () => {
      const rect = section.getBoundingClientRect();
      const vh = Math.max(1, window.innerHeight);
      const start = vh * 0.96;
      const end = vh * 0.28;
      const raw = (start - rect.top) / (start - end);
      const progress = Math.max(0, Math.min(1, raw));
      section.style.setProperty("--home-fade-progress", progress.toFixed(3));
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        update();
      });
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      section.style.removeProperty("--home-fade-progress");
    };
  }, []);

  return null;
}
