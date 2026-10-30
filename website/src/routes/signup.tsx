import { createFileRoute } from "@tanstack/react-router";
import { CompactCheckout } from "@/components/compact-checkout";
import { isPackageId, type PackageId } from "@/lib/compact-checkout";

export const Route = createFileRoute("/signup")({
  staticData: { sitemap: false },
  validateSearch: (search: Record<string, unknown>): { package?: PackageId } => {
    const value = search["package"];
    return isPackageId(value) ? { package: value } : {};
  },
  head: () => ({ meta: [
    { title: "Sign Up — Velovest" },
    { name: "description", content: "Choose a Velovest package, book your onboarding session and complete payment." },
    { name: "robots", content: "noindex" },
    { property: "og:title", content: "Sign Up — Velovest" },
    { property: "og:description", content: "Choose a package, book onboarding and get started with Velovest." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: SignupRoute,
});

function SignupRoute() {
  const { package: initialPackage } = Route.useSearch();
  return <CompactCheckout key={initialPackage ?? "none"} initialPackage={initialPackage}/>;
}
