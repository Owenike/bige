"use client";

import { useEffect } from "react";

export default function HomeScrollEffects() {
  useEffect(() => {
    const fadeSection = document.querySelector<HTMLElement>("[data-scroll-fade='dark-to-light']");
    const revealSections = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const parallaxMedia = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax-card] .homeLuxuryGridMedia"));
    const mobileServiceSection = document.querySelector<HTMLElement>("[data-mobile-service-section]");
    const mobileServiceCards = Array.from(document.querySelectorAll<HTMLElement>("[data-mobile-service-card]"));
    const mobileServices = window.matchMedia("(max-width: 780px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let rafId = 0;
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

    const updateMobileServiceReveal = () => {
      if (!mobileServiceSection || mobileServiceCards.length === 0) return;

      if (!mobileServices.matches || reducedMotion.matches) {
        mobileServiceCards.forEach((card) => {
          card.classList.add("is-mobile-service-visible");
          card.classList.remove("is-mobile-service-active");
          card.classList.remove("is-mobile-service-before");
          card.classList.remove("is-mobile-service-after");
        });
        return;
      }

      const vh = Math.max(1, window.innerHeight);
      const rect = mobileServiceSection.getBoundingClientRect();
      const travel = Math.max(1, rect.height - vh);
      const progress = clamp(-rect.top / travel, 0, 0.999);
      const activeIndex = clamp(Math.floor(progress * mobileServiceCards.length), 0, mobileServiceCards.length - 1);

      mobileServiceCards.forEach((card, index) => {
        card.classList.toggle("is-mobile-service-visible", index <= activeIndex);
        card.classList.toggle("is-mobile-service-active", index === activeIndex);
        card.classList.toggle("is-mobile-service-before", index < activeIndex);
        card.classList.toggle("is-mobile-service-after", index > activeIndex);
      });
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
        if (mobileServices.matches && track.hasAttribute("data-mobile-service-track")) continue;

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

        cleanupFns.push(() => {
          track.removeEventListener("scroll", onTrackScroll);
          window.removeEventListener("resize", updateDots);
          items.forEach((item) => item.classList.remove("is-swipe-active"));
          dotsHost.innerHTML = "";
          dotsHost.classList.remove("is-hidden");
        });
      }
    };

    const setupMobileServiceReveal = () => {
      if (mobileServiceCards.length === 0) return;
      updateMobileServiceReveal();
      cleanupFns.push(() => {
        mobileServiceCards.forEach((card) => {
          card.classList.remove("is-mobile-service-visible");
          card.classList.remove("is-mobile-service-active");
          card.classList.remove("is-mobile-service-before");
          card.classList.remove("is-mobile-service-after");
        });
      });
    };

    const runFrame = () => {
      updateFade();
      updateParallax();
      updateMobileServiceReveal();
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
    setupMobileServiceReveal();
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
      cleanupFns.forEach((fn) => fn());
    };
  }, []);

  return null;
}
