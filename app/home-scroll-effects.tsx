"use client";

import { useEffect } from "react";

export default function HomeScrollEffects() {
  useEffect(() => {
    const fadeSection = document.querySelector<HTMLElement>("[data-scroll-fade='dark-to-light']");
    const revealSections = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const parallaxMedia = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax-card] .homeLuxuryGridMedia"));
    const lineFab = document.querySelector<HTMLElement>(".homeLuxuryLineFab");

    let rafId = 0;
    let lastScrollY = window.scrollY;
    const cleanupFns: Array<() => void> = [];

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    const updateFade = () => {
      if (!fadeSection) return;
      const rect = fadeSection.getBoundingClientRect();
      const vh = Math.max(1, window.innerHeight);
      const start = vh * 1.05;
      const end = vh * 0.15;
      const raw = (start - rect.top) / (start - end);
      const progress = clamp(raw, 0, 1);
      fadeSection.style.setProperty("--home-fade-progress", progress.toFixed(3));
    };

    const updateParallax = () => {
      if (parallaxMedia.length === 0) return;
      const vh = Math.max(1, window.innerHeight);
      for (const media of parallaxMedia) {
        const rect = media.getBoundingClientRect();
        const centerOffset = (rect.top + rect.height * 0.5 - vh * 0.5) / vh;
        const shift = clamp(-centerOffset * 18, -14, 14);
        media.style.setProperty("--home-parallax", `${shift.toFixed(2)}px`);
      }
    };

    const updateLineFab = () => {
      if (!lineFab) return;
      const y = window.scrollY;
      const delta = y - lastScrollY;
      if (y < 120 || delta < -2) {
        lineFab.classList.remove("homeLineFabHidden");
      } else if (delta > 3) {
        lineFab.classList.add("homeLineFabHidden");
      }
      lastScrollY = y;
    };

    const setupRevealObserver = () => {
      if (revealSections.length === 0) return;
      if (!("IntersectionObserver" in window)) {
        revealSections.forEach((section) => section.classList.add("is-visible"));
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        },
        {
          threshold: 0.18,
          rootMargin: "0px 0px -8% 0px",
        },
      );

      revealSections.forEach((section) => observer.observe(section));
      cleanupFns.push(() => observer.disconnect());
    };

    const setupSwipeDots = () => {
      const tracks = Array.from(document.querySelectorAll<HTMLElement>("[data-swipe-track]"));
      for (const track of tracks) {
        const id = track.dataset.swipeTrack;
        if (!id) continue;

        const dotsHost = document.querySelector<HTMLElement>(`[data-swipe-dots='${id}']`);
        if (!dotsHost) continue;

        const items = Array.from(track.children) as HTMLElement[];
        if (items.length === 0) continue;

        dotsHost.innerHTML = "";
        const dots = items.map((_, index) => {
          const dot = document.createElement("span");
          dot.className = "homeSwipeDot";
          if (index === 0) dot.classList.add("is-active");
          dotsHost.appendChild(dot);
          return dot;
        });

        const updateDots = () => {
          if (items.length === 0) return;
          const center = track.scrollLeft + track.clientWidth * 0.5;
          let activeIndex = 0;
          let minDistance = Number.POSITIVE_INFINITY;

          items.forEach((item, index) => {
            const itemCenter = item.offsetLeft + item.offsetWidth * 0.5;
            const distance = Math.abs(itemCenter - center);
            if (distance < minDistance) {
              minDistance = distance;
              activeIndex = index;
            }
          });

          dots.forEach((dot, index) => dot.classList.toggle("is-active", index === activeIndex));
          dotsHost.classList.toggle("is-hidden", track.scrollWidth <= track.clientWidth + 2);
        };

        const onTrackScroll = () => window.requestAnimationFrame(updateDots);
        track.addEventListener("scroll", onTrackScroll, { passive: true });
        window.addEventListener("resize", updateDots);
        updateDots();

        cleanupFns.push(() => {
          track.removeEventListener("scroll", onTrackScroll);
          window.removeEventListener("resize", updateDots);
          dotsHost.innerHTML = "";
          dotsHost.classList.remove("is-hidden");
        });
      }
    };

    const runFrame = () => {
      updateFade();
      updateParallax();
      updateLineFab();
    };

    const requestFrame = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        runFrame();
      });
    };

    setupRevealObserver();
    setupSwipeDots();
    runFrame();

    window.addEventListener("scroll", requestFrame, { passive: true });
    window.addEventListener("resize", requestFrame);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", requestFrame);
      window.removeEventListener("resize", requestFrame);
      if (fadeSection) fadeSection.style.removeProperty("--home-fade-progress");
      parallaxMedia.forEach((media) => media.style.removeProperty("--home-parallax"));
      if (lineFab) lineFab.classList.remove("homeLineFabHidden");
      cleanupFns.forEach((fn) => fn());
    };
  }, []);

  return null;
}
