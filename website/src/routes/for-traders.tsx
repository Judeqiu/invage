import { createFileRoute } from "@tanstack/react-router";
import { CompactPage } from "@/components/compact-pages";

export const Route = createFileRoute("/for-traders")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "Options Learning Paths — Velovest" },
    { name: "description", content: "Find an options learning and review path for new, improving, and experienced traders." },
    { property: "og:title", content: "Options Learning Paths — Velovest" },
    { property: "og:description", content: "A useful next step at every level of options experience." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <CompactPage kind="traders"/>,
});
