import { createFileRoute } from "@tanstack/react-router";
import { CompactPage } from "@/components/compact-pages";

export const Route = createFileRoute("/product")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "Options Education & AI — Velovest" },
    { name: "description", content: "Explore Velovest's education-led options intelligence, portfolio review, and AI learning assistant." },
    { property: "og:title", content: "Options Education & AI — Velovest" },
    { property: "og:description", content: "Learn the mechanics, then connect them to the positions you review." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <CompactPage kind="product"/>,
});
