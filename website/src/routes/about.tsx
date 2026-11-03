import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { MarketingLayout } from "@/components/marketing-shell";

export const Route = createFileRoute("/about")({
  staticData: { sitemap: true },
  head: () => ({ meta: [
    { title: "About Us — Velovest" },
    { name: "description", content: "Founded by Victor Lim, Velovest helps traders run a disciplined options business with the Velovest Dashboard and coaching." },
    { property: "og:title", content: "About Velovest — Making Money Work for You" },
    { property: "og:description", content: "The story behind Velovest, the Options Business and the Velovest Dashboard." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: AboutPage,
});

const h2 = "text-2xl font-semibold sm:text-3xl";
const p = "mt-3 text-sm leading-7 text-muted-foreground sm:text-base";
const b = "font-semibold text-foreground";

function AboutPage() {
  return <MarketingLayout>
    <section className="border-b border-border px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto max-w-7xl text-center">
      <p className="text-[10px] font-bold uppercase text-primary">About Velovest</p>
      <h1 className="mx-auto mt-3 max-w-4xl text-balance text-3xl font-semibold leading-[1.08] sm:text-5xl">Making Money Work for You</h1>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Velovest was founded on a simple belief: <span className={b}>giving is the beginning of receiving, and true success is found in blessing others.</span></p>
    </div></section>
    <section className="bg-elevated px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto grid max-w-7xl gap-3 md:grid-cols-2">
      <article className="border border-border bg-card p-5 sm:p-6">
        <h2 className={h2}>Our Story</h2>
        <p className={p}>Since graduating from his corporate JOB ("Just Over Broke") back in 2010, our founder, <span className={b}>Victor Lim</span>, has managed businesses and investments entirely on his own terms and schedule. A core principle guides everything we do: <em>Do not chase after money; let money chase after you. Do not trade your time for money.</em> Wealth is about ownership—we encourage individuals to acquire income-producing assets and take charge of their financial education because <span className={b}>no one cares about your money more than you do.</span> When you learn to manage money, you stop working for it, and it starts working for you.</p>
      </article>
      <article className="border border-border bg-card p-5 sm:p-6">
        <h2 className={h2}>Why the Options Business?</h2>
        <p className={p}>Challenges are opportunities in disguise. In search of a highly efficient way to build sustainable income streams, Victor discovered the <span className={b}>Options Business</span>. Unlike traditional operations, this business model offers liberating advantages:</p>
        <ul className="mt-3 grid gap-2 text-sm sm:text-base">{[["Zero overheads", " and no real estate leases."], ["No employee management issues.", ""], ["No inventory", " to store or depreciate."], ["No cumbersome paperwork", " or logistics to handle."]].map(([bold, rest]) => <li key={bold} className="flex gap-2"><Check className="mt-1 size-4 shrink-0 text-primary"/><span><span className={b}>{bold}</span><span className="text-muted-foreground">{rest}</span></span></li>)}</ul>
        <p className={p}>It is a pure business centered on strategy, discipline, and consistent yield generation.</p>
      </article>
      <article className="border border-border bg-card p-5 sm:p-6">
        <h2 className={h2}>Solving a Real Pain Point</h2>
        <p className={p}>While treating this enterprise like a disciplined business, Victor maintained meticulous records of every transaction and cash flow. In sharing this path with friends, a glaring pain point emerged: <span className={b}>most people lack the discipline to keep track of multiple brokers and transactions.</span></p>
        <p className={p}>Determined to solve this challenge, the <span className={b}>Velovest Dashboard</span> was created to automatically synchronize transaction lifecycles across major retail brokers—allowing traders to focus entirely on strategy rather than spreadsheets.</p>
      </article>
      <article className="border border-border bg-card p-5 sm:p-6">
        <h2 className={h2}>Empowering Others</h2>
        <p className={p}>Velovest is built on giving more value than we take. Through our coaching and training programs, we guide newcomers step-by-step into the Options Business, helping them establish powerful new streams of income to secure financial freedom on their own terms.</p>
        <p className={p}><span className={b}>Velovest — Intelligent Investment Technology.</span> Let us help you master wealth management and build your financial future.</p>
      </article>
    </div></section>
  </MarketingLayout>;
}
