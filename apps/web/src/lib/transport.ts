// How a trip was travelled. Each Visit may say (Visit.transport); unset means
// plane, the default. The Hero Map draws the route to that trip in the mode's
// style — a dashed flight arc, a rail line with sleepers, a road with a centre
// line — with the vehicle at its midpoint, and the Place Detail lists it.
import { t } from "./i18n";
import type { Transport, Visit } from "./types";

export const TRANSPORTS: Transport[] = ["plane", "train", "bus", "car"];

export const DEFAULT_TRANSPORT: Transport = "plane";

export function transportOf(v: Pick<Visit, "transport">): Transport {
  return v.transport && TRANSPORTS.includes(v.transport) ? v.transport : DEFAULT_TRANSPORT;
}

export function transportLabel(mode: Transport): string {
  switch (mode) {
    case "plane":
      return t("Flight");
    case "train":
      return t("Train");
    case "bus":
      return t("Bus");
    case "car":
      return t("Drive");
  }
}

/** Filled vehicle silhouettes on a 24 px grid (fill-rule evenodd: windows
 * and lamps are holes). The plane is seen from above, nose up, so it can turn
 * with its route; the others face the viewer and stay upright. Drawn for this
 * project — shared by the map badges (Path2D) and the UI (SVG). */
export const TRANSPORT_GLYPH: Record<Transport, string> = {
  plane:
    "M12 2.2c.75 0 1.3.75 1.3 1.6v5.3l7.7 4.6v1.9l-7.7-2.3v4.4l2.3 1.7v1.5L12 20l-3.6.9v-1.5l2.3-1.7v-4.4L3 15.6v-1.9l7.7-4.6V3.8c0-.85.55-1.6 1.3-1.6z",
  train:
    "M8 2.5h8a3.5 3.5 0 0 1 3.5 3.5v9.5A3.5 3.5 0 0 1 16 19H8a3.5 3.5 0 0 1-3.5-3.5V6A3.5 3.5 0 0 1 8 2.5z" +
    "M7 6.2h10v4.6H7z" +
    "M8.3 13.4a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4z" +
    "M15.7 13.4a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4z" +
    "M8.2 19.6h2.3l-1.6 2.4H6.6z" +
    "M13.5 19.6h2.3l1.6 2.4h-2.3z",
  bus:
    "M6.5 2.5h11a2 2 0 0 1 2 2V17a1.5 1.5 0 0 1-1.5 1.5h-.5V21h-2.6v-2.5H9.1V21H6.5v-2.5H6A1.5 1.5 0 0 1 4.5 17V4.5a2 2 0 0 1 2-2z" +
    "M8 4.1h8v1.3H8z" +
    "M6.3 7h11.4v5.6H6.3z" +
    "M7.9 14.1a1.1 1.1 0 1 1 0 2.2a1.1 1.1 0 1 1 0-2.2z" +
    "M16.1 14.1a1.1 1.1 0 1 1 0 2.2a1.1 1.1 0 1 1 0-2.2z" +
    "M2.8 6.5h1v3.2h-1z" +
    "M20.2 6.5h1v3.2h-1z",
  car:
    "M7.2 5.3A2 2 0 0 1 9 4.2h6a2 2 0 0 1 1.8 1.1l1.9 4.2h.8a1.5 1.5 0 0 1 1.5 1.5v5.5a1 1 0 0 1-1 1h-.7V20h-2.6v-2.5H7.3V20H4.7v-2.5H4a1 1 0 0 1-1-1V11a1.5 1.5 0 0 1 1.5-1.5h.8z" +
    "M8.6 6.2h6.8l1.4 3.3H7.2z" +
    "M6.6 11.8a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4z" +
    "M17.4 11.8a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4z" +
    "M10 13.2h4v1.2h-4z",
};
