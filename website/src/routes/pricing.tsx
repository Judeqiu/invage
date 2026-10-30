import { createFileRoute } from "@tanstack/react-router";
import { CompactPricingPage } from "@/components/compact-checkout";

export const Route = createFileRoute("/pricing")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "Pricing — Velovest" },
    { name: "description", content: "Velovest packages: New to Options $1,080, Advanced Beginner $720, Yearly Renewal $228 (SGD)." },
    { property: "og:title", content: "Pricing — Velovest" },
    { property: "og:description", content: "Structured options education packages with Velovest Dashboard access and guided onboarding." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <CompactPricingPage/>,
});
