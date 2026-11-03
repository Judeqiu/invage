import { ArrowRight, Menu, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import logoDark from "@/assets/velovest-logo-dark.png";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const navigation = [
  { label: "Product", to: "/product" as const },
  { label: "For Traders", to: "/for-traders" as const },
  { label: "Integrations", to: "/integrations" as const },
  { label: "Resources", to: "/resources" as const },
  { label: "Pricing", to: "/pricing" as const },
];

export function Brand() {
  return <Link to="/" aria-label="Velovest.ai home" className="flex w-fit flex-none items-center">
    <img src={logoDark} alt="Velovest.ai — Intelligent Investment Technology" width={917} height={223} className="h-8 w-auto sm:h-9" />
  </Link>;
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        document.getElementById("navigation-toggle")?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  return <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-xl">
    <div className="mx-auto grid h-14 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 sm:flex sm:justify-between lg:px-8">
      <Brand />
      <nav className="hidden items-center gap-7 lg:flex" aria-label="Main navigation">
        {navigation.map(item => <Link key={item.to} to={item.to} activeProps={{ className: "text-foreground" }} className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">{item.label}</Link>)}
      </nav>
      <div className="hidden items-center gap-2 sm:flex"><Button asChild variant="ghost"><Link to="/login">Login</Link></Button><Button asChild><Link to="/signup">Sign Up <ArrowRight /></Link></Button></div>
      <Button variant="ghost" size="icon" id="navigation-toggle" className="shrink-0 lg:hidden" onClick={() => setOpen(value => !value)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="mobile-navigation">{open ? <X /> : <Menu />}</Button>
    </div>
    {open && <nav id="mobile-navigation" className="border-t border-border bg-background px-5 py-5 lg:hidden" aria-label="Mobile navigation">
      <div className="grid gap-1">{navigation.map(item => <Link key={item.to} to={item.to} onClick={() => setOpen(false)} className="py-3 text-sm text-muted-foreground">{item.label}</Link>)}</div>
      <div className="mt-4 grid grid-cols-2 gap-2"><Button asChild variant="outline"><Link to="/login" onClick={() => setOpen(false)}>Login</Link></Button><Button asChild><Link to="/signup" onClick={() => setOpen(false)}>Sign Up</Link></Button></div>
    </nav>}
  </header>;
}

export function SiteFooter() {
  return <footer className="border-t border-border px-5 py-7 lg:px-8"><div className="mx-auto max-w-7xl">
    <div className="grid gap-6 border-b border-border pb-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <div><Brand /><p className="mt-3 max-w-xs text-xs leading-5 text-muted-foreground">Education and AI-powered intelligence for running a disciplined options business.</p></div>
      <nav aria-label="Platform links"><p className="text-[10px] font-bold uppercase text-primary">Platform</p><ul className="mt-3 grid gap-2 text-xs text-muted-foreground">{navigation.map(item => <li key={item.to}><Link to={item.to} className="hover:text-foreground">{item.label}</Link></li>)}</ul></nav>
      <nav aria-label="Company links"><p className="text-[10px] font-bold uppercase text-primary">Company</p><ul className="mt-3 grid gap-2 text-xs text-muted-foreground"><li><Link to="/about" className="hover:text-foreground">About Us</Link></li><li><Link to="/contact" className="hover:text-foreground">Contact Us</Link></li><li><Link to="/login" className="hover:text-foreground">Login</Link></li><li><Link to="/signup" className="hover:text-foreground">Sign Up</Link></li></ul></nav>
      <nav aria-label="Legal links"><p className="text-[10px] font-bold uppercase text-primary">Legal</p><ul className="mt-3 grid gap-2 text-xs text-muted-foreground"><li><Link to="/risk-disclosure" className="hover:text-foreground">Risk Disclosure</Link></li><li title="Policy text pending">Privacy · Coming soon</li><li title="Policy text pending">Terms · Coming soon</li></ul></nav>
    </div>
    <div className="flex flex-col gap-5 pt-4 lg:flex-row lg:items-start lg:justify-between"><p className="max-w-4xl text-[11px] leading-6 text-muted-foreground">Trading options involves substantial risk and is not suitable for all investors. Velovest Options AI provides analytical and informational tools only and does not constitute investment, financial, or trading advice.</p><p className="shrink-0 text-[11px] text-muted-foreground">© 2026 Velovest Options AI</p></div>
  </div></footer>;
}

export function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="marketing-layout min-h-screen bg-background text-foreground"><SiteHeader /><main>{children}</main><SiteFooter /></div>;
}
