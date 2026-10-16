"use client";

import { GrainGradient } from "@paper-design/shaders-react";
import { CityScene } from "./city-scene";

/** Right-hand panel: the 3D surveyed neighbourhood with a soft grain-gradient light over it. */
export function AuthVisual() {
  return (
    <>
      <GrainGradient
        speed={0.6}
        scale={1}
        rotation={0}
        offsetX={0}
        offsetY={0}
        softness={0.6}
        intensity={0.45}
        noise={0.25}
        shape="corners"
        colors={["#0b2a8f", "#2a55d6", "#7c9cf0", "#0b2a8f"]}
        colorBack="#0b1a3a"
        className="absolute inset-0"
      />
      <CityScene className="absolute inset-0" />
      <GrainGradient
        speed={0.6}
        softness={0.7}
        intensity={0.25}
        noise={0.3}
        shape="corners"
        colors={["#ffffff", "#7c9cf0", "#2a55d6", "#ffffff"]}
        colorBack="#00000000"
        className="pointer-events-none absolute inset-0 opacity-20 mix-blend-soft-light"
      />
    </>
  );
}
