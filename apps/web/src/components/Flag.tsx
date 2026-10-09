"use client";

import { useState } from "react";

/** Country flag as a small SVG (public/flags, copied from country-flag-icons
 * at dev/build time). Unlike flag emoji, this renders on Windows too. Renders
 * nothing for a missing or implausible code (manual Places). */
export default function Flag({
  code,
  size = 16,
  className,
  title,
}: {
  code?: string;
  size?: number;
  className?: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const cc = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || failed) return null;
  return (
    <img
      className={"atlas-flag" + (className ? " " + className : "")}
      src={"/flags/" + cc + ".svg"}
      width={Math.round(size * 1.5)}
      height={size}
      alt={title ?? ""}
      title={title}
      aria-hidden={title ? undefined : true}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
