export const MAX_URI_BYTES = 3 * 1024;

// Any public git host: a named https host (no IPs, no ports) and an owner/repo path.
export const REPO_URL = /^https:\/\/(?![\d.]+\/)[a-z\d-]+(?:\.[a-z\d-]+)+\/~?[\w.-]+\/[\w.-]+(?:[/?#].*)?$/i;

export const MIN_SHIP_SECONDS = 30 * 60;

export const BASE_CAP = 6;

export const PROGRAM_START = process.env.NEXT_PUBLIC_PROGRAM_START ?? "2026-09-29";
// A date ("2026-10-13", midnight starting it) or an exact instant ("2026-10-14T05:00:00Z").
export const PROGRAM_END = process.env.NEXT_PUBLIC_PROGRAM_END ?? "2026-10-14T05:00:00Z";

export const instant = (d: string): Date => new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d);

// After this only resubmissions of sent-back ships are taken.
export const shippingClosed = () => Date.now() >= instant(PROGRAM_END).getTime();

export type Badge = {
  slug: string;
  title: string;
  bites: number;
  desc: string;
};

export const BADGES: Badge[] = [
  { slug: "canvas", title: "<canvas>", bites: 6, desc: "Draw your app with the Canvas API." },
  { slug: "audio", title: "web audio", bites: 5, desc: "Make sound with the Web Audio API. Synths, beeps, music." },
  { slug: "interactive", title: "interactive", bites: 3, desc: "Reacts to input: keyboard, mouse, touch, or mic." },
  { slug: "3d", title: "3D", bites: 8, desc: "Render in three dimensions. WebGL or something!" },
];

export const BADGE_BY_SLUG = new Map(BADGES.map((b) => [b.slug, b]));

export function capFor(badgeSlugs: string[]): number {
  return BASE_CAP + badgeSlugs.reduce((sum, s) => sum + (BADGE_BY_SLUG.get(s)?.bites ?? 0), 0);
}

export function bitesFor(awardedSeconds: number, badgeSlugs: string[]): number {
  // Round down, except .9 and up rounds up (2.9h → 3, 2.8h → 2). Whole seconds keep 2.9 exact.
  const hours = Math.floor((Math.round(awardedSeconds) + 360) / 3600);
  return Math.min(capFor(badgeSlugs), hours);
}

export type Reward = {
  slug: string;
  name: string;
  label: string[];
  desc: string;
  img?: string;
  w?: number;
  h?: number;
  cost: number;
  size: number;
  tilt: number;
  digital?: boolean;
};

export const REWARDS: Reward[] = [
  { slug: "stickers", name: "Hack Club stickers", label: ["stickers"], desc: "A few Hack Club stickers. Shipping is only tracked in India.", img: "stickers", w: 360, h: 250, cost: 1, size: 0.09, tilt: -3 },
  { slug: "nfc-stickers", name: "NFC stickers", label: ["NFC Stickers"], desc: "A pack of programmable NFC stickers.", img: "nfc-stickers", w: 720, h: 445, cost: 2, size: 0.09, tilt: -4 },
  { slug: "rubber-duck", name: "Debugger rubber duckie", label: ["debugger", "rubber duckie"], desc: "A rubber duck for rubber duck debugging.", img: "rubber-duck", w: 492, h: 557, cost: 2, size: 0.08, tilt: 3 },
  { slug: "floppy-disk", name: "Floppy disk", label: ["floppy disk"], desc: "A 3.5\" 1.44MB floppy disk.", img: "floppy-disk", w: 695, h: 720, cost: 2, size: 0.08, tilt: -2 },
  { slug: "sticker-pack", name: "Hack Club sticker pack", label: ["sticker pack"], desc: "A pack of Hack Club stickers.", img: "sticker-pack", w: 357, h: 247, cost: 2, size: 0.09, tilt: 5 },
  { slug: "magazine", name: "Hack Club magazine", label: ["the magazine"], desc: "The 2025 Hack Club magazine.", img: "magazine", w: 508, h: 720, cost: 2, size: 0.09, tilt: -3 },
  { slug: "domain", name: "Domain for a year", label: ["$12 domain", "grant"], desc: "$12 grant toward a domain for one year.", img: "domain", w: 720, h: 330, cost: 2, size: 0.13, tilt: 2, digital: true },
  { slug: "app-store", name: "Play Store or App Store grant", label: ["$7 app store", "grant"], desc: "$7 grant toward a Google Play or Apple App Store developer account.", img: "app-store", w: 480, h: 720, cost: 2, size: 0.08, tilt: -2, digital: true },
  { slug: "xiao-esp32", name: "XIAO ESP32", label: ["XIAO ESP32"], desc: "Seeed Studio XIAO ESP32, a thumb-sized board with Wi-Fi and Bluetooth.", img: "xiao-esp32", w: 485, h: 641, cost: 3, size: 0.06, tilt: 4 },
  { slug: "orpheus-pico", name: "Orpheus Pico", label: ["Orpheus Pico"], desc: "Hack Club's RP2040 microcontroller board.", img: "orpheus-pico", w: 720, h: 277, cost: 3, size: 0.13, tilt: -4 },
  { slug: "micro-plushie", name: "Micro plushie", label: ["micro plushie"], desc: "A small plush toy.", img: "micro-plushie", w: 425, h: 576, cost: 3, size: 0.07, tilt: 3 },
  { slug: "blahaj", name: "Blåhaj", label: ["Blåhaj"], desc: "The IKEA Blåhaj shark plush.", img: "blahaj", w: 720, h: 414, cost: 6, size: 0.11, tilt: -3 },
  { slug: "balatro", name: "Balatro", label: ["Balatro"], desc: "A Steam key for Balatro.", img: "balatro", w: 362, h: 176, cost: 3, size: 0.1, tilt: -3, digital: true },
  { slug: "gift-card", name: "Steam or GOG gift card", label: ["$10 game", "card"], desc: "$10 Steam or GOG.com gift card.", img: "gift-card", w: 720, h: 600, cost: 2, size: 0.1, tilt: 3, digital: true },
  { slug: "tiny-lego", name: "Tiny Lego set", label: ["tiny Lego"], desc: "Any LEGO set up to $12.", img: "tiny-lego", w: 720, h: 329, cost: 3, size: 0.12, tilt: -2 },
  { slug: "socks", name: "Hack Club socks", label: ["Hack Club", "socks"], desc: "A pair of Hack Club socks.", img: "socks", w: 405, h: 720, cost: 4, size: 0.1, tilt: 4 },
  { slug: "tamagotchi", name: "Tamagotchi", label: ["Tamagotchi"], desc: "An original Tamagotchi virtual pet.", img: "tamagotchi", w: 610, h: 720, cost: 5, size: 0.08, tilt: -3 },
  { slug: "pi-zero-2w", name: "Raspberry Pi Zero 2 W", label: ["Raspberry Pi", "Zero 2 W"], desc: "Raspberry Pi Zero 2 W with header and case.", img: "pi-zero-2w", w: 720, h: 507, cost: 5, size: 0.1, tilt: -3 },
  { slug: "badger-2040w", name: "Badger 2040 W", label: ["Badger 2040 W"], desc: "Pimoroni Badger 2040 W, a programmable e-ink badge with Wi-Fi.", img: "badger-2040w", w: 720, h: 364, cost: 5, size: 0.08, tilt: 2 },
  { slug: "claw-machine", name: "Mini claw machine", label: ["mini claw", "machine"], desc: "A mini desktop claw machine.", img: "claw-machine", w: 535, h: 720, cost: 5, size: 0.09, tilt: -4 },
  { slug: "thumby", name: "Thumby", label: ["Thumby"], desc: "A keychain-sized game console you program in Python.", img: "thumby", w: 425, h: 720, cost: 6, size: 0.07, tilt: 3 },
  { slug: "thermal-printer", name: "Thermal printer", label: ["thermal", "printer"], desc: "A small thermal receipt printer.", img: "thermal-printer", w: 720, h: 678, cost: 7, size: 0.09, tilt: 4 },
  { slug: "retro-handheld", name: "Retro handheld", label: ["retro", "handheld"], desc: "A retro handheld up to $60, such as the Miyoo Mini Plus.", img: "retro-handheld", w: 529, h: 720, cost: 11, size: 0.08, tilt: -3 },
  { slug: "keyboard", name: "Mechanical keyboard", label: ["mechanical", "keyboard"], desc: "Any mechanical keyboard up to $90.", img: "keyboard", w: 720, h: 274, cost: 15, size: 0.13, tilt: 2 },
];

export const REWARD_BY_SLUG = new Map(REWARDS.map((r) => [r.slug, r]));

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Paid to the referrer once, when the person they brought in gets their first ship approved.
export const REFERRAL_BITES = 1;

export const REFERRAL_PLEDGE = "i promise not to spam my link";

// Case, spacing, curly quotes and a trailing full stop don't matter.
export function pledgeMatches(typed: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  return norm(typed) === norm(REFERRAL_PLEDGE);
}
