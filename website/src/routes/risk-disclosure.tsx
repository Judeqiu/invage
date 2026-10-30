import { createFileRoute } from "@tanstack/react-router";
import { CompactPage } from "@/components/compact-pages";

export const Route = createFileRoute("/risk-disclosure")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "Options Risk Disclosure — Velovest" },
    { name: "description", content: "Understand assignment, downside, capital commitment, missed upside, and AI limitations." },
    { property: "og:title", content: "Options Risk Disclosure — Velovest" },
    { property: "og:description", content: "Income-oriented options strategies still involve substantial risk." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <CompactPage kind="risk"/>,
});
