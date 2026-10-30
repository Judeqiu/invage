import { createFileRoute } from "@tanstack/react-router";
import { CompactPage } from "@/components/compact-pages";

export const Route = createFileRoute("/resources")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "Options Learning Resources — Velovest" },
    { name: "description", content: "Learn options foundations, the Wheel strategy, risk, capital requirements, and responsible AI use." },
    { property: "og:title", content: "Options Learning Resources — Velovest" },
    { property: "og:description", content: "Start with the obligation, not only the opportunity." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <CompactPage kind="resources"/>,
});
