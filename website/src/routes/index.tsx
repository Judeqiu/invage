import { createFileRoute } from "@tanstack/react-router";
import { CompactHomepage } from "@/components/compact-pages";

export const Route = createFileRoute("/")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "Velovest Options AI — Learn Options With Context" },
    { name: "description", content: "Learn options mechanics, the Wheel strategy, and responsible portfolio review before using Velovest AI." },
    { property: "og:title", content: "Velovest Options AI — Learn Options With Context" },
    { property: "og:description", content: "Learn the Wheel, understand the risks, and use AI to review options with greater context." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <CompactHomepage/>,
});
