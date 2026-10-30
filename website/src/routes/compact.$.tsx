import { createFileRoute, redirect } from "@tanstack/react-router";

// Design 6 used to live under /compact; it is now the main site, so old links forward to the same page.
export const Route = createFileRoute("/compact/$")({
  staticData: { sitemap: false },
  beforeLoad: ({ params, location }) => {
    throw redirect({ href: `/${params._splat ?? ""}${location.searchStr}`, statusCode: 301 });
  },
});
