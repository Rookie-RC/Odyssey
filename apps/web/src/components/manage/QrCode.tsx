"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { t } from "../../lib/i18n";

/** Theme-coloured QR code as inline SVG (no canvas, no network). */
export default function QrCode({ value, size = 148 }: { value: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { path: d, count: n };
  }, [value]);
  const quiet = 2;
  return (
    <svg
      className="atlas-qr"
      viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}
      width={size}
      height={size}
      role="img"
      aria-label={t("QR code for {url}", { url: value })}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={count + quiet * 2} height={count + quiet * 2} fill="#fff" />
      <path d={path} fill="#111" />
    </svg>
  );
}
