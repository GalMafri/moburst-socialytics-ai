import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Card, VideoSpec } from "./spec";

// Fonts and files come in as file:// paths the renderer may load (the worker renders with --disable-web-security off: it writes
// the spec with paths under video/public and refers to them relatively). Here they are plain URLs.
// A staged asset (a bare file name under video/public) is served by Remotion through staticFile; a URL passes through.
const asset = (p: string) => (/^(https?:|data:|file:|blob:)/.test(p) ? p : staticFile(p));
const face = (name: string, url: string) => `@font-face { font-family: '${name}'; src: url('${asset(url)}'); }`;

const CardView: React.FC<{ card: Card; spec: VideoSpec; frames: number }> = ({ card, spec, frames }) => {
  const frame = useCurrentFrame();
  const inF = Math.min(10, Math.floor(frames / 4));
  const opacity = interpolate(frame, [0, inF, frames - inF, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rise = interpolate(frame, [0, inF], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const { x, y, w, h } = card.slot;
  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          position: "absolute", left: x * spec.width, top: y * spec.height + rise, width: w * spec.width, height: h * spec.height,
          display: "flex", flexDirection: "column", justifyContent: "center", alignItems: card.align === "center" ? "center" : "flex-start",
          textAlign: card.align, color: card.ink,
        }}
      >
        <div data-slot="headline" style={{ fontFamily: "Brand-headline", fontSize: card.headlinePx, lineHeight: 1.15, whiteSpace: "pre-wrap" }}>{card.headline}</div>
        {card.subline ? (
          <div data-slot="subline" style={{ fontFamily: "Brand-subline", fontSize: card.sublinePx || Math.round(card.headlinePx * 0.5), lineHeight: 1.25, marginTop: Math.round(card.headlinePx * 0.4), whiteSpace: "pre-wrap" }}>{card.subline}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ spec: VideoSpec; frames: number }> = ({ spec, frames }) => {
  const frame = useCurrentFrame();
  const inF = Math.min(12, Math.max(1, Math.floor(frames / 4)));
  const opacity = interpolate(frame, [0, inF], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const end = spec.endCard!;
  return (
    <AbsoluteFill style={{ background: end.ground }}>
      <Img
        src={asset(spec.logo.path)}
        data-slot="logo"
        style={{ position: "absolute", left: end.logoBox.x * spec.width, top: end.logoBox.y * spec.height, width: end.logoBox.w * spec.width,
                 height: end.logoBox.h * spec.height, objectFit: "contain", objectPosition: "center", opacity }}
      />
    </AbsoluteFill>
  );
};


export const BrandCards: React.FC<{ spec: VideoSpec }> = ({ spec }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  let start = 0;
  const ground = spec.cards[0]?.ground || "#000";
  const second = frame / fps;
  const caption = (spec.captions || []).find((c) => second >= c.start && second < c.end);
  const cs = spec.captionStyle || { ink: "#ffffff", ground: "rgba(0,0,0,0.6)", px: 44, bottomInset: 480 };
  const cardFrames = spec.cards.reduce((n, c) => n + Math.round(c.seconds * fps), 0);
  const endFrames = spec.endCard ? Math.round(spec.endCard.seconds * fps) : 0;
  const onEndCard = !!spec.endCard && frame >= cardFrames;
  // the plate moves slowly the whole way (a push of 6% plus a drift), the way a designer animates a still
  const plateScale = interpolate(frame, [0, Math.max(1, durationInFrames)], [1.0, 1.06], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const plateShift = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, -0.015 * spec.width], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const hasGround = !!spec.broll?.path || !!spec.plate?.path;
  return (
    <AbsoluteFill style={{ background: ground }}>
      <style>{[face("Brand-headline", spec.fonts.headline), face("Brand-subline", spec.fonts.subline)].join("\n")}</style>
      {spec.plate?.path && !onEndCard ? (
        <AbsoluteFill>
          <Img src={asset(spec.plate.path)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${plateScale}) translateX(${plateShift}px)` }} />
          {spec.plate.darken ? <AbsoluteFill style={{ background: `rgba(0,0,0,${spec.plate.darken})` }} /> : null}
        </AbsoluteFill>
      ) : null}
      {spec.broll?.path && !onEndCard ? (
        <AbsoluteFill>
          <OffthreadVideo src={asset(spec.broll.path)} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
          <AbsoluteFill style={{ background: `rgba(0,0,0,${spec.broll.darken ?? 0.45})` }} />
        </AbsoluteFill>
      ) : null}
      {spec.cards.map((card, i) => {
        const frames = Math.round(card.seconds * fps);
        const from = start;
        start += frames;
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            {!hasGround ? <AbsoluteFill style={{ background: card.ground }} /> : null}
            <CardView card={card} spec={spec} frames={frames} />
          </Sequence>
        );
      })}
      {spec.endCard && spec.logo.path ? (
        <Sequence from={cardFrames} durationInFrames={Math.max(1, endFrames)}>
          <EndCard spec={spec} frames={endFrames} />
        </Sequence>
      ) : null}
      {spec.logo.path && !onEndCard ? (
        <Img
          src={asset(spec.logo.path)}
          data-slot="logo"
          style={{ position: "absolute", left: spec.logo.box.x * spec.width, top: spec.logo.box.y * spec.height, width: spec.logo.box.w * spec.width, height: spec.logo.box.h * spec.height, objectFit: "contain", objectPosition: "left top" }}
        />
      ) : null}
      {caption ? (
        <div data-slot="caption" style={{ position: "absolute", left: "8%", width: "84%", bottom: cs.bottomInset, textAlign: "center" }}>
          <span style={{ fontFamily: "Brand-subline", fontSize: cs.px, lineHeight: 1.3, color: cs.ink, background: cs.ground, padding: "8px 16px", borderRadius: 8, boxDecorationBreak: "clone" }}>{caption.text}</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
