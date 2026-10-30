import { createFileRoute } from "@tanstack/react-router";
import { CompactConfirmation, type Booking } from "@/components/compact-checkout";
import { isPackageId, isSlotTime, type PackageId, type SlotTime } from "@/lib/compact-checkout";

type ConfirmationSearch = { ref?: string; pkg?: PackageId; date?: string; time?: SlotTime; name?: string; email?: string };

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : undefined);

export const Route = createFileRoute("/confirmation")({
  staticData: { sitemap: false },
  validateSearch: (search: Record<string, unknown>): ConfirmationSearch => {
    const out: ConfirmationSearch = {};
    const ref = text(search["ref"], 12);
    if (ref && /^VV-[A-Z0-9]{6}$/.test(ref)) out.ref = ref;
    if (isPackageId(search["pkg"])) out.pkg = search["pkg"];
    const date = text(search["date"], 10);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
    if (isSlotTime(search["time"])) out.time = search["time"];
    const name = text(search["name"], 80);
    if (name) out.name = name;
    const email = text(search["email"], 120);
    if (email) out.email = email;
    return out;
  },
  head: () => ({ meta: [
    { title: "Proof of Payment Received — Velovest" },
    { name: "description", content: "Your PayNow proof of payment has been received and is being verified." },
    { name: "robots", content: "noindex" },
    { property: "og:title", content: "Proof of Payment Received — Velovest" },
    { property: "og:description", content: "You will receive an appointment confirmation email once payment is verified." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: ConfirmationRoute,
});

function ConfirmationRoute() {
  const { ref, pkg, date, time, name, email } = Route.useSearch();
  const booking: Booking | null = ref && pkg && date && time && name && email ? { ref, pkg, date, time, name, email } : null;
  return <CompactConfirmation booking={booking}/>;
}
