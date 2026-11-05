"use client";
import { ReactLenis } from "lenis/react";

export default function SmoothScroll() {
  return <ReactLenis
    root
    options={{
      autoRaf: true,
      anchors: true,
      lerp: 0.115,
      smoothWheel: true,
      touchMultiplier: 1,
      respectReducedMotion: true,
      stopInertiaOnNavigate: true,
      prevent: node => Boolean(node.closest("[data-lenis-prevent]"))
    }}
  />;
}
