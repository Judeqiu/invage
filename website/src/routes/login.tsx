import { createFileRoute, redirect } from "@tanstack/react-router";

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
  beforeLoad: ({ location }) => {
    // Authenticate on the workspace origin so its existing session cookie and return path work.
    throw redirect({ href: `https://chat.velovest.lextok.com/login${location.searchStr}` });
  },
});
