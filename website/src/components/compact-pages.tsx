import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CompactPricingTeaser } from "@/components/compact-checkout";
import { ArrowRight, Bot, CalendarClock, Check, GraduationCap, Leaf, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { MarketingLayout } from "@/components/marketing-shell";
import { Button } from "@/components/ui/button";
import { HomepageBenefits } from "@/components/homepage-benefits";
import { pageData, personas, wheelSteps, type PageKind } from "@/components/site-content";
import { cn } from "@/lib/utils";

/** Velovest site pages: homepage, secondary pages and login. */

const learningItems = [
  [CalendarClock, "Learn at your pace", "Use practical examples to make options mechanics easier to understand."],
  [Leaf, "Build a repeatable habit", "Replace scattered research with a structured learning and review routine."],
  [ShieldCheck, "Put risk beside opportunity", "See assignment, capital requirements, losses, and missed upside—not only premium."],
  [Sparkles, "Use AI as an assistant", "Ask plain-English questions, then verify the answer against source information."],
] as const;

const section = "px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12";
const eyebrow = "text-[10px] font-bold uppercase text-primary";
const h2 = "mt-2 text-balance text-2xl font-semibold leading-tight sm:text-4xl";
const lead = "mt-3 text-sm leading-6 text-muted-foreground";

function SectionHead({ label, title, copy, className }: { label: string; title: string; copy?: string; className?: string }) {
  return <div className={cn("max-w-3xl", className)}><p className={eyebrow}>{label}</p><h2 className={h2}>{title}</h2>{copy && <p className={lead}>{copy}</p>}</div>;
}

function CompactWorkspace() {
  const prompts = ["Explain this wheel position.", "What happens if I’m assigned?", "Which expiry needs review?"] as const;
  const [selected, setSelected] = useState<(typeof prompts)[number]>(prompts[0]);
  return <div className="overflow-hidden border border-border bg-card shadow-panel lg:grid lg:grid-cols-[.82fr_1.18fr]">
    <div className="border-b border-border bg-secondary p-5 lg:border-b-0 lg:border-r sm:p-6">
      <div className="flex items-center gap-2 text-xs font-semibold"><span className="grid size-7 place-items-center bg-chart-2 text-primary-foreground"><Bot className="size-4"/></span>Velovest AI learning assistant</div>
      <p className="mt-4 text-xl font-semibold">Ask about the mechanics before the outcome.</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Explore a simulated position, its obligations, and the risks that remain.</p>
      <div className="mt-4 grid gap-2">{prompts.map(prompt => <Button key={prompt} variant="ghost" onClick={() => setSelected(prompt)} className={cn("h-auto justify-start whitespace-normal border border-border py-2.5 text-left text-xs text-foreground hover:bg-accent hover:text-foreground", selected === prompt && "border-chart-2 bg-accent")}>{prompt}</Button>)}</div>
    </div>
    <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className={eyebrow}>Simulated wheel review</p><span className="border border-border px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">Educational example</span></div>
      <h3 className="mt-3 text-xl font-semibold">ACME · Cash-secured put</h3>
      <div className="mt-4 grid grid-cols-3 gap-2">{[["Strike", "$95"], ["Expiry", "28 days"], ["Capital reserved", "$9,500"]].map(([label, value]) => <div key={label} className="bg-elevated p-3"><p className="text-[9px] font-bold uppercase text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold sm:text-base">{value}</p></div>)}</div>
      <div className="mt-3 border-l-4 border-primary bg-secondary p-4"><p className="text-sm font-semibold">{selected}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">This position may collect premium, but assignment could require buying 100 shares per contract at the strike. Losses remain possible if the share price falls.</p></div>
      <p className="mt-3 text-[9px] leading-4 text-muted-foreground">Illustrative figures only. This is education, not personalized advice or an income forecast.</p>
    </div>
  </div>;
}

function CompactCallout({ title, copy }: { title: string; copy: string }) {
  return <section className="border-y border-primary/25 bg-primary/5 px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto flex max-w-7xl flex-col gap-5 text-center lg:flex-row lg:items-center lg:justify-between lg:text-left">
    <div><h2 className="text-balance text-2xl font-semibold sm:text-3xl">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{copy}</p></div>
    <div className="flex shrink-0 flex-col justify-center gap-2 sm:flex-row"><Button asChild size="lg"><Link to="/signup">Sign Up <ArrowRight/></Link></Button><Button asChild size="lg" variant="outline"><Link to="/pricing">View Pricing</Link></Button></div>
  </div></section>;
}

export function CompactHomepage() {
  return <MarketingLayout>
    <section className="border-b border-border px-4 pb-8 pt-7 sm:px-6 sm:pb-10 sm:pt-9 lg:px-8"><div className="mx-auto max-w-7xl text-center">
      <div className="inline-flex items-center gap-2 border border-primary/20 bg-secondary px-3 py-1 text-[10px] font-bold uppercase text-primary"><GraduationCap className="size-3.5"/>Learn before you trade</div>
      <h1 className="mx-auto mt-4 max-w-5xl text-balance text-[2rem] font-semibold leading-[1.06] sm:text-5xl lg:text-6xl">Build a Sustainable Income Stream with an <span className="text-primary">Options Business Engine.</span></h1>
      <HomepageBenefits centered/>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row sm:gap-3"><Button asChild size="lg"><Link to="/resources">Start Learning <ArrowRight/></Link></Button><Button asChild size="lg" variant="outline"><Link to="/product">See Velovest AI</Link></Button></div>
      <p className="mx-auto mt-4 max-w-2xl text-xs leading-5 text-muted-foreground">Options are not passive income or guaranteed income. Every premium comes with an obligation and risk of loss.</p>
    </div></section>

    <section className={cn("bg-elevated", section)}><div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[.7fr_1.3fr] lg:items-center lg:gap-8">
      <SectionHead label="A productive learning path" title="Give your investing time a clear purpose." copy="Build knowledge in small steps: learn the contract, understand the obligation, review the trade-offs, and decide independently whether it fits your objectives."/>
      <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">{learningItems.map(([Icon, title, copy]) => <article key={title} className="flex gap-3 border border-border bg-card p-4"><Icon className="mt-0.5 size-5 shrink-0 text-primary"/><div><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p></div></article>)}</div>
    </div></section>

    <section className={section}><div className="mx-auto max-w-7xl">
      <SectionHead label="Wheel strategy · four-part lesson" title="Learn the cycle—and every obligation inside it." copy="The Wheel combines cash-secured puts and covered calls. It can produce premium, but it also commits capital and can create losses or limit gains."/>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">{wheelSteps.map(({ number, title, copy, Icon, tone, border }) => <article key={number} className={cn("border border-t-4 bg-card p-4", border)}><div className="flex items-center justify-between"><span className="text-[10px] font-bold text-muted-foreground">LESSON {number}</span><Icon className={cn("size-5", tone)}/></div><h3 className="mt-3 text-lg font-semibold">{title}</h3><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{copy}</p></article>)}</div>
      <div className="mt-3 border-l-4 border-warning bg-elevated p-4"><p className="text-sm font-semibold">The cycle is not automatic, and profit is never assured.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The Wheel may underperform simply holding shares, tie up substantial capital, trigger assignment, and expose investors to meaningful downside.</p></div>
    </div></section>

    <section className={cn("border-y border-border bg-secondary", section)}><div className="mx-auto max-w-7xl">
      <SectionHead label="When the foundation is clear" title="Continue from where you are."/>
      <div className="mt-5 grid gap-2 sm:gap-3 lg:grid-cols-3">{personas.map(({ id, Icon, title, copy, question }, index) => <article key={id} className="flex flex-col border border-border bg-card p-4 sm:p-5">
        <div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center bg-elevated text-primary"><Icon className="size-4"/></span><h3 className="text-lg font-semibold leading-snug">{title}</h3><span className="ml-auto text-[10px] font-bold text-muted-foreground">0{index + 1}</span></div>
        <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{copy}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"><p className="text-sm italic">“{question}”</p><Link to="/for-traders" hash={id} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">Explore <ArrowRight className="size-3.5"/></Link></div>
      </article>)}</div>
    </div></section>

    <section className={section}><div className="mx-auto max-w-7xl">
      <SectionHead label="Education meets intelligence" title="Learn the strategy. Then review the reality." copy="Velovest connects explanations to the positions, expirations, premium, and obligations you are reviewing." className="mb-5"/>
      <CompactWorkspace/>
    </div></section>

    <CompactPricingTeaser/>

    <section className="border-t border-border bg-elevated px-4 py-6 sm:px-6 lg:px-8"><div className="mx-auto grid max-w-7xl gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-5">
      <ShieldCheck className="size-6 text-primary"/>
      <div><h2 className="text-lg font-semibold sm:text-xl">Education supports judgment. It does not replace it.</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Velovest is not a brokerage or financial adviser. AI can be incomplete or wrong, and every strategy requires independent evaluation.</p></div>
      <Button asChild variant="outline"><Link to="/risk-disclosure">Read Risk Disclosure</Link></Button>
    </div></section>
    <CompactCallout title="Build Knowledge Before Complexity." copy="Start an educational workspace for clearer questions, more structured reviews, and informed independent decisions."/>
  </MarketingLayout>;
}

export function CompactPage({ kind }: { kind: PageKind }) {
  const page = pageData[kind];
  const cols = page.cards.length === 3 ? "lg:grid-cols-3" : page.cards.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4";
  return <MarketingLayout>
    <section className="border-b border-border px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto max-w-7xl text-center">
      <p className={eyebrow}>Velovest Academy · {page.eyebrow}</p>
      <h1 className="mx-auto mt-3 max-w-4xl text-balance text-3xl font-semibold leading-[1.08] sm:text-5xl">{page.title}</h1>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">{page.copy}</p>
    </div></section>
    <section className={cn("bg-elevated", section)}><div className="mx-auto max-w-7xl">
      <h2 className="text-2xl font-semibold sm:text-3xl">{page.section}</h2>
      <div className={cn("mt-4 grid gap-2 sm:grid-cols-2 sm:gap-3", cols)}>{page.cards.map(([code, title, copy], index) => <article key={`${code}-${title}`} id={kind === "traders" ? personas[index]?.id : undefined} className="border border-border bg-card p-4">
        <div className="flex items-center justify-between"><span className="text-[10px] font-bold text-primary">{code}</span><Check className="size-4 text-chart-2"/></div>
        <h3 className="mt-2 text-base font-semibold sm:text-lg">{title}</h3>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{copy}</p>
        {kind === "integrations" && <p className="mt-3 text-[9px] font-bold uppercase text-primary">Connected</p>}
      </article>)}</div>
      {kind === "product" && <div className="mt-6"><CompactWorkspace/></div>}
      <p className="mt-4 text-[9px] text-muted-foreground">Educational and informational tools only. No strategy or outcome is guaranteed.</p>
    </div></section>
    {kind !== "risk" && <CompactCallout title="Keep Learning With Context." copy="Use clear lessons and structured reviews to ask better questions about options."/>}
  </MarketingLayout>;
}

export function CompactAuthPage({ mode }: { mode: "login" | "signup" }) {
  const login = mode === "login";
  return <div><main className="grid min-h-screen place-items-center bg-background px-4 py-6 sm:px-6"><section className="w-full max-w-4xl">
    <Link to="/" className="mb-4 inline-flex text-sm text-muted-foreground hover:text-foreground">← Back to Velovest Academy</Link>
    <div className="grid overflow-hidden border border-border bg-card shadow-panel md:grid-cols-[.9fr_1.1fr]">
      <div className="bg-elevated p-6 sm:p-8"><GraduationCap className="size-6 text-primary"/><p className={cn(eyebrow, "mt-5")}>{login ? "Welcome back" : "Start learning"}</p><h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">{login ? "Continue with context." : "Build knowledge first."}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{login ? "Return to your education and options intelligence workspace." : "Create a free educational workspace. No brokerage transfer required."}</p></div>
      <div className="p-6 sm:p-8"><form className="space-y-4" onSubmit={event => event.preventDefault()}>
        <label className="block text-sm font-medium">Email address<input type="email" required placeholder="you@example.com" className="mt-1.5 h-10 w-full border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-ring"/></label>
        <label className="block text-sm font-medium">{login ? "Password" : "Create password"}<input type="password" required placeholder={login ? "••••••••" : "8+ characters"} className="mt-1.5 h-10 w-full border border-input bg-background px-3 outline-none focus:ring-2 focus:ring-ring"/></label>
        <Button className="h-10 w-full" type="submit">{login ? <LockKeyhole/> : <ShieldCheck/>}{login ? "Login" : "Create Free Account"}</Button>
      </form><p className="mt-4 text-center text-sm text-muted-foreground">{login ? <>New to Velovest? <Link to="/signup" className="font-semibold text-primary">Create an account</Link></> : <>Already have an account? <Link to="/login" className="font-semibold text-primary">Login</Link></>}</p></div>
    </div>
  </section></main></div>;
}
