"use client";

import { useEffect } from "react";

export default function HomeScrollEffects() {
  useEffect(() => {
    const fadeSection = document.querySelector<HTMLElement>("[data-scroll-fade='dark-to-light']");
    const revealSections = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const parallaxMedia = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax-card] .homeLuxuryGridMedia"));
    const lineFab = document.querySelector<HTMLElement>(".homeLuxuryLineFab");
    const lockSwipeTrackIds = new Set(["training", "choices"]);

    let rafId = 0;
    let lastScrollY = window.scrollY;
    const cleanupFns: Array<() => void> = [];

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    const updateFade = () => {
      if (!fadeSection) return;
      const rect = fadeSection.getBoundingClientRect();
      const vh = Math.max(1, window.innerHeight);
      const travel = Math.max(1, rect.height - vh);
      const raw = travel > 1 ? -rect.top / travel : (vh * 1.05 - rect.top) / (vh * 0.9);
      const progress = clamp(raw, 0, 1);
      fadeSection.style.setProperty("--home-fade-progress", progress.toFixed(3));
      fadeSection.style.setProperty("--home-pin-progress", progress.toFixed(3));
      fadeSection.classList.toggle("is-theme-dark", progress < 0.52);
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
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
            } else {
              entry.target.classList.remove("is-visible");
            }
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
      type LockConfig = {
        track: HTMLElement;
        section: HTMLElement;
        updateDots: () => void;
      };
      const lockConfigs: LockConfig[] = [];

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

          items.forEach((item, index) => item.classList.toggle("is-swipe-active", index === activeIndex));
          dots.forEach((dot, index) => dot.classList.toggle("is-active", index === activeIndex));
          dotsHost.classList.toggle("is-hidden", track.scrollWidth <= track.clientWidth + 2);
        };

        const onTrackScroll = () => window.requestAnimationFrame(updateDots);
        track.addEventListener("scroll", onTrackScroll, { passive: true });
        window.addEventListener("resize", updateDots);
        updateDots();

        if (lockSwipeTrackIds.has(id)) {
          const section = track.closest("section");
          if (section instanceof HTMLElement) {
            lockConfigs.push({ track, section, updateDots });
          }
        }

        cleanupFns.push(() => {
          track.removeEventListener("scroll", onTrackScroll);
          window.removeEventListener("resize", updateDots);
          items.forEach((item) => item.classList.remove("is-swipe-active"));
          dotsHost.innerHTML = "";
          dotsHost.classList.remove("is-hidden");
        });
      }

      if (lockConfigs.length === 0) return;

      const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;
      const getMaxScrollLeft = (trackEl: HTMLElement) => Math.max(0, trackEl.scrollWidth - trackEl.clientWidth);
      const canConsumeDelta = (config: LockConfig, delta: number) => {
        if (!isMobileViewport()) return false;
        const maxScrollLeft = getMaxScrollLeft(config.track);
        if (maxScrollLeft <= 2) return false;
        const left = config.track.scrollLeft;
        const atStart = left <= 1;
        const atEnd = left >= maxScrollLeft - 1;
        if (delta > 0) return !atEnd;
        if (delta < 0) return !atStart;
        return false;
      };

      const getLockConfigFromTarget = (target: EventTarget | null) => {
        if (!(target instanceof Node)) return null;
        return lockConfigs.find((config) => config.section.contains(target)) ?? null;
      };

      const getActiveLockConfig = () => {
        if (!isMobileViewport()) return null;
        const vh = Math.max(1, window.innerHeight);
        let picked: LockConfig | null = null;
        let bestScore = 0;

        for (const config of lockConfigs) {
          const rect = config.section.getBoundingClientRect();
          const visible = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
          if (visible <= 0) continue;
          if (rect.top >= vh * 0.88 || rect.bottom <= vh * 0.12) continue;

          const center = rect.top + rect.height * 0.5;
          const centerDistance = Math.abs(center - vh * 0.5);
          const score = visible - centerDistance * 0.15;
          if (score > bestScore) {
            bestScore = score;
            picked = config;
          }
        }

        return picked;
      };

      const consumeVerticalDelta = (delta: number, preferred: LockConfig | null) => {
        const ordered = preferred
          ? [preferred, ...lockConfigs.filter((config) => config !== preferred)]
          : lockConfigs;

        for (const config of ordered) {
          if (!canConsumeDelta(config, delta)) continue;
          config.track.scrollLeft += delta * 1.2;
          window.requestAnimationFrame(config.updateDots);
          return true;
        }
        return false;
      };

      const onWindowWheel = (event: WheelEvent) => {
        if (!isMobileViewport()) return;
        const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (Math.abs(dominantDelta) < 0.8) return;

        const preferred = getLockConfigFromTarget(event.target) ?? getActiveLockConfig();
        if (!preferred) return;
        if (consumeVerticalDelta(dominantDelta, preferred)) {
          event.preventDefault();
        }
      };

      let lastTouchX = 0;
      let lastTouchY = 0;
      let touchPreferred: LockConfig | null = null;

      const onWindowTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) return;
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
        touchPreferred = getLockConfigFromTarget(event.target) ?? getActiveLockConfig();
      };

      const onWindowTouchMove = (event: TouchEvent) => {
        if (!isMobileViewport()) return;
        if (event.touches.length !== 1) return;

        const touch = event.touches[0];
        const dx = touch.clientX - lastTouchX;
        const dy = touch.clientY - lastTouchY;
        lastTouchX = touch.clientX;
        lastTouchY = touch.clientY;

        if (Math.abs(dy) <= Math.abs(dx)) return;
        const dominantDelta = -dy;
        if (Math.abs(dominantDelta) < 0.6) return;

        const preferred = touchPreferred ?? getLockConfigFromTarget(event.target) ?? getActiveLockConfig();
        if (!preferred) return;
        if (consumeVerticalDelta(dominantDelta, preferred)) {
          event.preventDefault();
        }
      };

      const resetTouchPreferred = () => {
        touchPreferred = null;
      };

      window.addEventListener("wheel", onWindowWheel, { passive: false });
      window.addEventListener("touchstart", onWindowTouchStart, { passive: true });
      window.addEventListener("touchmove", onWindowTouchMove, { passive: false });
      window.addEventListener("touchend", resetTouchPreferred, { passive: true });
      window.addEventListener("touchcancel", resetTouchPreferred, { passive: true });

      cleanupFns.push(() => {
        window.removeEventListener("wheel", onWindowWheel);
        window.removeEventListener("touchstart", onWindowTouchStart);
        window.removeEventListener("touchmove", onWindowTouchMove);
        window.removeEventListener("touchend", resetTouchPreferred);
        window.removeEventListener("touchcancel", resetTouchPreferred);
      });
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
      if (fadeSection) {
        fadeSection.style.removeProperty("--home-fade-progress");
        fadeSection.style.removeProperty("--home-pin-progress");
        fadeSection.classList.remove("is-theme-dark");
      }
      parallaxMedia.forEach((media) => media.style.removeProperty("--home-parallax"));
      if (lineFab) lineFab.classList.remove("homeLineFabHidden");
      cleanupFns.forEach((fn) => fn());
    };
  }, []);

  return null;
}
