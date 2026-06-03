"use client";

import { useEffect, useState } from "react";

export default function HomeIntroVideo() {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    if (!showIntro) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [showIntro]);

  if (!showIntro) return null;

  const closeIntro = () => setShowIntro(false);

  return (
    <section className="homeIntroVideoOverlay" aria-label="BigE intro video">
      <video
        className="homeIntroVideoMedia"
        autoPlay
        muted
        playsInline
        preload="auto"
        poster="/home-videos/hero-poster.jpg"
        onEnded={closeIntro}
        onError={closeIntro}
      >
        <source src="/home-videos/hero-mobile.mp4" media="(max-width: 767px)" type="video/mp4" />
        <source src="/home-videos/hero-desktop.mp4" type="video/mp4" />
      </video>
      <div className="homeIntroVideoShade" aria-hidden />
      <div className="homeIntroVideoChrome">
        <span className="homeIntroVideoBrand">BigE Fitness</span>
        <button className="homeIntroVideoSkip" type="button" onClick={closeIntro}>
          跳過
        </button>
      </div>
      <div className="homeIntroVideoStatement" aria-hidden>
        <span>綻放優雅，雕塑不凡</span>
        <span>Strength. Grace. Transformation.</span>
      </div>
    </section>
  );
}
