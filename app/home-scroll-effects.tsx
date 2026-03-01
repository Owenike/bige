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
            const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;
            const getMaxScrollLeft = () => Math.max(0, track.scrollWidth - track.clientWidth);
            const canConsumeDelta = (delta: number) => {
              if (!isMobileViewport()) return false;
              const maxScrollLeft = getMaxScrollLeft();
              if (maxScrollLeft <= 2) return false;
              const left = track.scrollLeft;
              const atStart = left <= 1;
              const atEnd = left >= maxScrollLeft - 1;
              if (delta > 0) return !atEnd;
              if (delta < 0) return !atStart;
              return false;
            };

            const consumeDelta = (delta: number) => {
              track.scrollLeft += delta * 1.08;
              window.requestAnimationFrame(updateDots);
            };

            const onSectionWheel = (event: WheelEvent) => {
              const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
              if (Math.abs(dominantDelta) < 0.7) return;
              if (!canConsumeDelta(dominantDelta)) return;
              event.preventDefault();
              consumeDelta(dominantDelta);
            };

            let touchStartX = 0;
            let touchStartY = 0;
            let lastTouchX = 0;
            let lastTouchY = 0;

            const onSectionTouchStart = (event: TouchEvent) => {
              if (event.touches.length !== 1) return;
              const touch = event.touches[0];
              touchStartX = touch.clientX;
              touchStartY = touch.clientY;
              lastTouchX = touch.clientX;
              lastTouchY = touch.clientY;
            };

            const onSectionTouchMove = (event: TouchEvent) => {
              if (!isMobileViewport()) return;
              if (event.touches.length !== 1) return;
              const touch = event.touches[0];

              const fromStartX = touch.clientX - touchStartX;
              const fromStartY = touch.clientY - touchStartY;
              const stepX = touch.clientX - lastTouchX;
              const stepY = touch.clientY - lastTouchY;
              lastTouchX = touch.clientX;
              lastTouchY = touch.clientY;

              if (Math.abs(fromStartY) < 6) return;
              if (Math.abs(fromStartY) < Math.abs(fromStartX) * 0.9) return;

              const verticalIntent = -stepY;
              if (!canConsumeDelta(verticalIntent)) return;
              event.preventDefault();
              consumeDelta(verticalIntent);
            };

            section.addEventListener("wheel", onSectionWheel, { passive: false });
            section.addEventListener("touchstart", onSectionTouchStart, { passive: true });
            section.addEventListener("touchmove", onSectionTouchMove, { passive: false });

            cleanupFns.push(() => {
              section.removeEventListener("wheel", onSectionWheel);
              section.removeEventListener("touchstart", onSectionTouchStart);
              section.removeEventListener("touchmove", onSectionTouchMove);
            });
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
