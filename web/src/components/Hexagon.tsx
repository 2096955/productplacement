/* ============================================================
   Hexagon.tsx — the HSBC-style red hexagon device, inline SVG.
   Landscape hexagon (wider than tall, pointed left/right) with red
   top/bottom + tip triangles and two white triangles pointing inward —
   a stylised, illustrative interpretation for a conference context;
   NOT the registered mark. See DISCLAIMER in the footer.
   ============================================================ */
import { ACCENT } from "@/theme";

export function Hexagon({ size = 34 }: { size?: number }) {
  // viewBox is 46 x 40 (ratio 1.15) so the device is wider than tall,
  // matching the real proportions instead of looking squished.
  const w = Math.round(size * 1.15);
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 46 40"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="HSBC-style hexagon device (illustrative)"
      focusable="false"
      style={{ display: "block" }}
    >
      {/* white hexagon base */}
      <polygon points="2,20 13,2 33,2 44,20 33,38 13,38" fill="#FFFFFF" />
      {/* red top + bottom triangles meeting at centre */}
      <polygon points="13,2 33,2 23,20" fill={ACCENT} />
      <polygon points="13,38 33,38 23,20" fill={ACCENT} />
      {/* red left + right tip triangles */}
      <polygon points="2,20 13,2 13,38" fill={ACCENT} />
      <polygon points="44,20 33,2 33,38" fill={ACCENT} />
      {/* (the two white triangles 13,2-23,20-13,38 and 33,2-23,20-33,38 remain) */}
    </svg>
  );
}
