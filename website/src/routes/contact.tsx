import { createFileRoute } from "@tanstack/react-router";
import { Mail, MapPin, MessageCircle } from "lucide-react";
import { MarketingLayout } from "@/components/marketing-shell";

export const Route = createFileRoute("/contact")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "Contact Us — Velovest" },
    { name: "description", content: "Get in touch with Velovest by email or WhatsApp, or visit us at Eunos Techpark, Singapore." },
    { property: "og:title", content: "Contact Us — Velovest" },
    { property: "og:description", content: "Email, WhatsApp and office address for Velovest in Singapore." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: ContactPage,
});

function ContactPage() {
  return <MarketingLayout>
    <section className="border-b border-border px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto max-w-7xl text-center">
      <p className="text-[10px] font-bold uppercase text-primary">Contact Us</p>
      <h1 className="mx-auto mt-3 max-w-4xl text-balance text-3xl font-semibold leading-[1.08] sm:text-5xl">We're here to help.</h1>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Reach us by email or WhatsApp, or visit our office in Singapore.</p>
    </div></section>
    <section className="bg-elevated px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto grid max-w-7xl gap-3 md:grid-cols-3">
      <a href="mailto:victor@viconium.com" className="border border-border bg-card p-5 hover:border-primary"><Mail aria-hidden="true" className="size-5 text-primary"/><h2 className="mt-3 text-lg font-semibold">Email</h2><p className="mt-1 text-sm text-muted-foreground break-all">victor@viconium.com</p></a>
      <a href="https://wa.me/6596383772" target="_blank" rel="noopener noreferrer" className="border border-border bg-card p-5 hover:border-primary"><MessageCircle aria-hidden="true" className="size-5 text-primary"/><h2 className="mt-3 text-lg font-semibold">WhatsApp</h2><p className="mt-1 text-sm text-muted-foreground">+65 9638 3772</p><p className="mt-3 text-xs font-semibold text-primary">Open WhatsApp <span className="sr-only">(opens in a new tab)</span>↗</p></a>
      <a href="https://www.google.com/maps/search/?api=1&amp;query=60%20Kaki%20Bukit%20Place%20Singapore%20415979" target="_blank" rel="noopener noreferrer" className="border border-border bg-card p-5 hover:border-primary"><MapPin aria-hidden="true" className="size-5 text-primary"/><h2 className="mt-3 text-lg font-semibold">Address</h2><address className="mt-1 text-sm not-italic leading-6 text-muted-foreground">60 Kaki Bukit Place,<br/>#03-17 Eunos Techpark,<br/>Lobby A, Exit A,<br/>Singapore 415979</address><p className="mt-3 text-xs font-semibold text-primary">View on Google Maps <span className="sr-only">(opens in a new tab)</span>↗</p></a>
    </div></section>
  </MarketingLayout>;
}
