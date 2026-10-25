import { H1 } from "@/app/components/ui/bits";
import { SHOP_REWARDS } from "@/lib/program";
import { requireUser } from "@/lib/server/auth/current";
import { HCA_ADDRESSES_URL, HCA_VERIFY_URL } from "@/lib/server/auth/hca";
import { balance } from "@/lib/server/ledger";
import { addressesFor } from "@/lib/server/orders";

import Shop from "./Shop";

export default async function ShopPage() {
  const user = await requireUser("/app/shop");
  const [bites, addresses] = await Promise.all([balance(user.id), addressesFor(user).catch(() => "reconnect" as const)]);

  return (
    <>
      <H1
        sub={
          <>
            You have <span className="font-pixel">{bites} BITES</span>.
          </>
        }
      >
        the shop
      </H1>
      <Shop
        rewards={SHOP_REWARDS.map((r) => ({
          slug: r.slug,
          name: r.name,
          desc: r.desc,
          img: r.img ?? null,
          w: r.w ?? 4,
          h: r.h ?? 3,
          cost: r.cost,
          digital: Boolean(r.digital),
          tilt: r.tilt,
        }))}
        bites={bites}
        eligibility={user.eligibility}
        addresses={addresses === "reconnect" ? null : addresses.map((a) => ({ id: a.id, ...a.address }))}
        hcaAddressesUrl={HCA_ADDRESSES_URL}
        hcaVerifyUrl={HCA_VERIFY_URL}
      />
    </>
  );
}
