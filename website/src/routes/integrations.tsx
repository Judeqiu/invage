import { createFileRoute } from "@tanstack/react-router";
import { CompactPage } from "@/components/compact-pages";

export const Route = createFileRoute("/integrations")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "Broker Integrations — Velovest" },
    { name: "description", content: "Connect Interactive Brokers, moomoo, Webull and Tiger Trade to the Velovest educational intelligence workspace." },
    { property: "og:title", content: "Broker Integrations — Velovest" },
    { property: "og:description", content: "Keep your broker and add educational context around your portfolio information." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <CompactPage kind="integrations"/>,
});
