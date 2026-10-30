import { createFileRoute } from "@tanstack/react-router";
import { CompactAuthPage } from "@/components/compact-pages";

export const Route = createFileRoute("/login")({
  staticData: { sitemap: false },
  head: () => ({ meta: [
    { title: "Login — Velovest" },
    { name: "description", content: "Log in to your Velovest education and options intelligence workspace." },
    { name: "robots", content: "noindex" },
    { property: "og:title", content: "Login — Velovest" },
    { property: "og:description", content: "Continue learning options with context." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <CompactAuthPage mode="login"/>,
});
