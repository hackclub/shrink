// Shared by the order dialog and placeOrder() so both agree on what a phone number needs.

// Hack Club addresses carry either a code or a name here.
export const isUS = (country: string) => /^(us|usa|united states( of america)?)$/i.test(country.trim());

// Couriers outside the US won't deliver without one, so it's required there.
export const phoneRequired = (country: string) => !isUS(country);

// Loose on purpose: formats vary by country. Returns the trimmed number, or null if it can't be one.
export function cleanPhone(raw: string): string | null {
  const phone = raw.trim().replace(/\s+/g, " ");
  if (!/^\+?[0-9 ().-]+$/.test(phone)) return null;
  const digits = phone.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15 ? phone : null;
}
