import "server-only";

import { shortMac, safeEqual } from "./crypto";
import { shipById } from "./ships";

// /play/<id> is open for approved ships. Before that, it takes a key so the secondary check can
// play a pending ship without the link being guessable from anything else we publish.
export const playUrl = (origin: string, shipId: string) => `${origin}/play/${shipId}?k=${shortMac(`play.${shipId}`)}`;

export async function playable(shipId: string, key: string | undefined) {
  const ship = await shipById(shipId);
  if (!ship) return null;
  if (ship.state === "approved") return ship;
  return key && safeEqual(key, shortMac(`play.${ship.id}`)) ? ship : null;
}
