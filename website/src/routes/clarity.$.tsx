import { createFileRoute, redirect } from "@tanstack/react-router";

// This earlier design was retired; old links forward to the homepage.
export const Route = createFileRoute("/clarity/$")({
  staticData: { sitemap: false },
  beforeLoad: () => {
    throw redirect({ href: "/", statusCode: 301 });
  },
});
