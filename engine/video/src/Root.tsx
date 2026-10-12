import React from "react";
import { Composition, staticFile } from "remotion";
import { BrandCards } from "./BrandCards";
import type { VideoSpec } from "./spec";

const EMPTY: VideoSpec = {
  width: 1080, height: 1920, fps: 30,
  fonts: { headline: "", subline: "" },
  logo: { path: "", box: { x: 0.06, y: 0.05, w: 0.3, h: 0.05 } },
  cards: [{ headline: "Preview", seconds: 2, ink: "#ffffff", ground: "#0e1b2e", slot: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, headlinePx: 72, align: "center" }],
};

export const Root: React.FC = () => (
  <Composition
    id="BrandCards"
    component={BrandCards}
    durationInFrames={60}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ spec: EMPTY }}
    calculateMetadata={({ props }) => {
      const spec = props.spec as VideoSpec;
      const seconds = spec.cards.reduce((a, c) => a + c.seconds, 0);
      return { durationInFrames: Math.max(1, Math.round(seconds * spec.fps)), fps: spec.fps, width: spec.width, height: spec.height };
    }}
  />
);

export { staticFile };
