import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Clock, FileCheck2, Hourglass, Loader2, Mail, Printer, QrCode, ShieldCheck, Upload, X } from "lucide-react";
import { MarketingLayout } from "@/components/marketing-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PACKAGE_IDS, SLOT_TIMES, VERIFICATION_NOTE, bookableDates, createReference, dateParts, formatSessionDate, formatSlot, formatSGD,
  isSlotTaken, packageItems, packageMinutes, packageTotal, packages, serviceItems, type PackageId, type SlotTime,
} from "@/lib/compact-checkout";

const eyebrow = "text-[10px] font-bold uppercase text-primary";
const field = "mt-1.5 h-10 w-full border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring aria-[invalid=true]:border-destructive";
const ACCESS_NOTE = "Access to the Velovest system will be given during your onboarding session.";

/* ---------- Shared pieces ---------- */

function PackageCard({ id, selected, children }: { id: PackageId; selected?: boolean; children?: ReactNode }) {
  const info = packages[id];
  const minutes = packageMinutes(id);
  return <article className={cn("relative flex flex-col border bg-card p-4 sm:p-5", selected ? "border-primary ring-1 ring-primary" : info.featured ? "border-primary/50" : "border-border")}>
    {info.featured && <span className="absolute -top-2.5 left-4 bg-primary px-2 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">Full programme</span>}
    <p className={eyebrow}>{info.tier}</p>
    <h3 className="mt-1 text-lg font-semibold">{info.name}</h3>
    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{info.summary}</p>
    <p className="mt-3 flex items-baseline gap-1.5"><span className="text-3xl font-semibold tabular-nums">{formatSGD(packageTotal(id))}</span><span className="text-xs text-muted-foreground">SGD · {info.billing}</span></p>
    <p className="mt-1 text-xs text-muted-foreground">{minutes > 0 ? `${minutes / 60} hours of guided sessions + Dashboard access` : "Velovest Dashboard access · 12 months"}</p>
    <ul className="mt-3 flex-1 space-y-1.5 border-t border-border pt-3 text-sm">
      {packageItems(id).map(item => <li key={item.id} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-chart-2"/><span className="flex-1">{item.name}{item.minutes && <span className="text-muted-foreground"> · {item.minutes} min</span>}</span></li>)}
    </ul>
    {children && <div className="mt-4">{children}</div>}
  </article>;
}

const STEPS = [["Choose package", "Package"], ["Book onboarding", "Booking"], ["Pay via PayNow", "PayNow"], ["Payment verification", "Verify"]] as const;

function Stepper({ current }: { current: number }) {
  return <ol className="grid grid-cols-4 gap-1.5" aria-label="Sign-up progress">
    {STEPS.map(([label, short], index) => <li key={label} aria-current={index === current ? "step" : undefined} className={cn("border-t-2 pt-2", index <= current ? "border-primary" : "border-border")}>
      <span className={cn("flex items-center gap-1 text-[10px] font-bold uppercase", index < current ? "text-chart-2" : index === current ? "text-primary" : "text-muted-foreground")}>{(index < current) && <Check className="size-3"/>}Step {index + 1}</span>
      <span className={cn("mt-0.5 block text-xs font-semibold", index <= current ? "text-foreground" : "text-muted-foreground")}><span className="hidden sm:inline">{label}</span><span className="sm:hidden">{short}</span></span>
    </li>)}
  </ol>;
}

function OrderSummary({ pkg, date, time }: { pkg: PackageId; date?: string | undefined; time?: SlotTime | undefined }) {
  const info = packages[pkg];
  return <aside className="border border-border bg-elevated p-4 lg:sticky lg:top-20" aria-label="Order summary">
    <p className={eyebrow}>Order summary</p>
    <p className="mt-2 font-semibold">{info.name} <span className="font-normal text-muted-foreground">· {info.tier}</span></p>
    <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs">{packageItems(pkg).map(item => <li key={item.id} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-chart-2"/><span className="text-muted-foreground">{item.name}</span></li>)}</ul>
    <div className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs"><CalendarDays className="mt-0.5 size-4 shrink-0 text-primary"/><div><p className="font-semibold">Onboarding session</p><p className="text-muted-foreground">{date && time ? <>{formatSessionDate(date)}<br/>{formatSlot(time)}</> : "Not booked yet"}</p></div></div>
    <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3"><span className="text-sm font-semibold">Total via PayNow</span><span className="text-xl font-semibold tabular-nums">{formatSGD(packageTotal(pkg), true)} <span className="text-[10px] font-normal text-muted-foreground">SGD</span></span></div>
    <p className="mt-3 border-l-2 border-primary pl-2 text-[11px] leading-5 text-muted-foreground">{ACCESS_NOTE}</p>
  </aside>;
}

/* ---------- Pricing ---------- */

export function CompactPricingTeaser() {
  return <section className="border-t border-border px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12"><div className="mx-auto max-w-7xl">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl"><p className={eyebrow}>Pricing</p><h2 className="mt-2 text-balance text-2xl font-semibold leading-tight sm:text-4xl">Pick your starting point.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Structured packages with clear, upfront pricing in SGD. Every package includes Velovest Dashboard access.</p></div>
      <Link to="/pricing" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary">Compare full pricing <ArrowRight className="size-4"/></Link>
    </div>
    <div className="mt-5 grid gap-2 sm:gap-3 lg:grid-cols-3">{PACKAGE_IDS.map(id => <article key={id} className={cn("flex items-center justify-between gap-3 border bg-card p-4", packages[id].featured ? "border-primary/50" : "border-border")}>
      <div><p className={eyebrow}>{packages[id].tier}</p><h3 className="mt-1 text-base font-semibold">{packages[id].name}</h3><p className="mt-0.5 text-xs text-muted-foreground"><span className="text-lg font-semibold text-foreground tabular-nums">{formatSGD(packageTotal(id))}</span> SGD · {packages[id].billing}</p></div>
      <Button asChild size="sm" variant={packages[id].featured ? "default" : "outline"}><Link to="/signup" search={{ package: id }}>Choose <ArrowRight/></Link></Button>
    </article>)}</div>
  </div></section>;
}

const howItWorks = [
  [Check, "Choose a package", "Pick the path that matches your experience."],
  [CalendarDays, "Book onboarding", "Select a 60-minute slot in Singapore time."],
  [QrCode, "Pay via PayNow", "Scan the QR code, then upload your proof of payment."],
  [ShieldCheck, "Get confirmed", "Appointment confirmed by email once payment is verified."],
] as const;

export function CompactPricingPage() {
  const cell = "px-3 py-2.5 text-right tabular-nums";
  return <MarketingLayout>
    <section className="border-b border-border px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto max-w-7xl text-center">
      <p className={eyebrow}>Velovest Academy · Pricing</p>
      <h1 className="mx-auto mt-3 max-w-4xl text-balance text-3xl font-semibold leading-[1.08] sm:text-5xl">Structured packages. Clear, upfront pricing.</h1>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">Choose the path that matches where you are. Every package includes Velovest Dashboard access, set up with you during your onboarding session.</p>
    </div></section>

    <section className="bg-elevated px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto max-w-7xl">
      <div className="grid gap-3 pt-2 lg:grid-cols-3">{PACKAGE_IDS.map(id => <PackageCard key={id} id={id}><Button asChild className="w-full" variant={packages[id].featured ? "default" : "outline"}><Link to="/signup" search={{ package: id }}>Choose {packages[id].name} <ArrowRight/></Link></Button></PackageCard>)}</div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{howItWorks.map(([Icon, title, copy], index) => <li key={title} className="flex gap-3 border border-border bg-card p-3"><span className="grid size-8 shrink-0 place-items-center bg-secondary text-primary"><Icon className="size-4"/></span><div><p className="text-sm font-semibold"><span className="text-muted-foreground">{index + 1}.</span> {title}</p><p className="text-xs leading-5 text-muted-foreground">{copy}</p></div></li>)}</ol>
    </div></section>

    <section className="px-4 py-8 sm:px-6 sm:py-10 lg:px-8"><div className="mx-auto max-w-7xl">
      <p className={eyebrow}>Compare packages</p>
      <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Velovest Pricing &amp; Service Matrix</h2>
      <p className="mt-1 text-sm text-muted-foreground">What each package includes. All prices in SGD.</p>
      <div className="mt-4 overflow-x-auto border border-border">
        <table className="w-full min-w-[620px] border-collapse bg-card text-sm">
          <thead><tr className="bg-secondary text-left">
            <th scope="col" className="px-3 py-3 text-xs font-bold uppercase">Product &amp; Service Offerings</th>
            {PACKAGE_IDS.map(id => <th key={id} scope="col" className="px-3 py-3 text-right text-xs font-bold"><span className="block">{packages[id].name}</span><span className="block font-normal text-muted-foreground">{packages[id].tier}</span></th>)}
          </tr></thead>
          <tbody>{serviceItems.map(item => <tr key={item.id} className="border-t border-border">
            <th scope="row" className="px-3 py-2.5 text-left font-medium">{item.name}{item.minutes && <span className="font-normal text-muted-foreground"> ({item.minutes} mins)</span>}</th>
            {PACKAGE_IDS.map(id => { const price = item.prices[id]; return <td key={id} className={cn(cell, price === undefined && "text-muted-foreground")}>{price === undefined ? <span aria-label="Not included">—</span> : <Check className="ml-auto size-4 text-chart-2" aria-label="Included"/>}</td>; })}
          </tr>)}</tbody>
          <tfoot><tr className="border-t-2 border-primary bg-elevated font-semibold">
            <th scope="row" className="px-3 py-3 text-left">Total Investment</th>
            {PACKAGE_IDS.map(id => <td key={id} className={cn(cell, "py-3 text-base")}>{formatSGD(packageTotal(id), true)}</td>)}
          </tr></tfoot>
        </table>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{ACCESS_NOTE} Velovest provides education and software tools only — not investment advice. No strategy or outcome is guaranteed.</p>
    </div></section>
  </MarketingLayout>;
}

/* ---------- Sign-up checkout ---------- */

type Details = { name: string; email: string; phone: string; txn: string; agree: boolean };
const emptyDetails: Details = { name: "", email: "", phone: "", txn: "", agree: false };
type Errors = Partial<Record<keyof Details | "proof", string>>;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

function validate(d: Details, proof: File | null) {
  const errors: Errors = {};
  if (d.name.trim().length < 2) errors.name = "Enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) errors.email = "Enter a valid email address.";
  if (!proof) errors.proof = "Upload a screenshot or PDF of your PayNow payment.";
  else if (proof.size > MAX_PROOF_BYTES) errors.proof = "File is larger than 5 MB.";
  else if (!/^image\/|application\/pdf/.test(proof.type)) errors.proof = "Upload an image (PNG, JPG) or PDF.";
  if (!d.agree) errors.agree = "Please confirm to continue.";
  return errors;
}

function Field({ label, error, children, optional }: { label: string; error?: string | undefined; children: ReactNode; optional?: boolean }) {
  return <label className="block text-sm font-medium">{label}{optional && <span className="font-normal text-muted-foreground"> (optional)</span>}{children}{error && <span className="mt-1 block text-xs text-destructive">{error}</span>}</label>;
}

/** Placeholder PayNow QR artwork — swap for the business's real PayNow QR image. */
function DemoQr({ seed }: { seed: string }) {
  const n = 25;
  const finder = (x: number, y: number) => [[0, 0], [n - 7, 0], [0, n - 7]].some(([fx = 0, fy = 0]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const finderOn = (x: number, y: number) => { for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) { const dx = x - fx, dy = y - fy; if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4); } return false; };
  let h = 7; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const on = finder(x, y) ? finderOn(x, y) : (((x * 73856093) ^ (y * 19349663) ^ h) >>> 0) % 7 < 3;
    if (on) cells.push([x, y]);
  }
  return <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="size-full" role="img" aria-label="PayNow QR code (sample)"><rect x="-2" y="-2" width={n + 4} height={n + 4} className="fill-foreground"/>{cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" className="fill-background"/>)}</svg>;
}

export function CompactCheckout({ initialPackage }: { initialPackage?: PackageId | undefined }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(initialPackage ? 1 : 0);
  const [pkg, setPkg] = useState<PackageId | undefined>(initialPackage);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState<string>();
  const [time, setTime] = useState<SlotTime>();
  const [reference, setReference] = useState<string>();
  const [details, setDetails] = useState<Details>(emptyDetails);
  const [proof, setProof] = useState<File | null>(null);
  const [proofUrl, setProofUrl] = useState<string>();
  const [errors, setErrors] = useState<Errors>({});
  const [processing, setProcessing] = useState(false);

  useEffect(() => { setDates(bookableDates(new Date())); }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); if (step === 2) setReference(prev => prev ?? createReference()); }, [step]);
  useEffect(() => {
    if (!proof || !proof.type.startsWith("image/")) { setProofUrl(undefined); return; }
    const url = URL.createObjectURL(proof); setProofUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proof]);

  const clearError = (key: keyof Errors) => setErrors(prev => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next; });
  const set = <K extends keyof Details>(key: K, value: Details[K]) => { setDetails(prev => ({ ...prev, [key]: value })); clearError(key); };
  const choose = (id: PackageId) => { setPkg(id); setStep(1); };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validate(details, proof);
    setErrors(found);
    if (Object.keys(found).length > 0 || !pkg || !date || !time || !reference) return;
    setProcessing(true);
    window.setTimeout(() => {
      void navigate({ to: "/confirmation", search: { ref: reference, pkg, date, time, name: details.name.trim(), email: details.email.trim() } });
    }, 1200);
  };

  const titles = ["Choose your package.", "Book your onboarding session.", "Pay via PayNow."];

  return <MarketingLayout>
    <section className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8"><div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className={eyebrow}>Sign up · Velovest Academy</p><h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-4xl">{titles[step]}</h1></div><p className="text-xs text-muted-foreground">Already have an account? <Link to="/login" className="font-semibold text-primary">Login</Link></p></div>
      <div className="mt-4"><Stepper current={step}/></div>

      {step === 0 && <div className="mt-6 grid gap-3 lg:grid-cols-3">{PACKAGE_IDS.map(id => <PackageCard key={id} id={id} selected={pkg === id}><Button className="w-full" variant={packages[id].featured ? "default" : "outline"} onClick={() => choose(id)}>Choose {packages[id].name} <ArrowRight/></Button></PackageCard>)}</div>}

      {step > 0 && pkg && <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
        {step === 1 && <div className="border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="size-4 text-primary"/>Pick a date</h2><span className="border border-border px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Singapore Time · SGT (UTC+8)</span></div>
          <div className="mt-3 grid grid-cols-5 gap-1.5" role="group" aria-label="Available dates">{dates.map(d => { const p = dateParts(d); const active = d === date; return <button key={d} type="button" aria-pressed={active} aria-label={formatSessionDate(d)} onClick={() => { setDate(d); setTime(undefined); }} className={cn("border px-1 py-2 text-center transition-colors", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-elevated hover:border-primary/60")}>
            <span className={cn("block text-[10px] font-bold uppercase", active ? "text-primary-foreground" : "text-muted-foreground")}>{p.weekdayShort}</span><span className="block text-lg font-semibold leading-tight">{p.day}</span><span className={cn("block text-[10px]", active ? "text-primary-foreground" : "text-muted-foreground")}>{p.monthShort}</span>
          </button>; })}</div>

          <h2 className="mt-5 flex items-center gap-2 text-base font-semibold"><Clock className="size-4 text-primary"/>Pick a time {date && <span className="text-sm font-normal text-muted-foreground">· {formatSessionDate(date)}</span>}</h2>
          {date ? <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="group" aria-label="Available times">{SLOT_TIMES.map(t => { const taken = isSlotTaken(date, t); const active = t === time; return <button key={t} type="button" disabled={taken} aria-pressed={active} onClick={() => setTime(t)} className={cn("border px-2 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed", active ? "border-primary bg-primary text-primary-foreground" : taken ? "border-border bg-muted text-muted-foreground line-through" : "border-border bg-elevated hover:border-primary/60")}>
            <span className="block font-semibold">{formatSlot(t, false)}</span><span className={cn("block text-[10px]", active ? "text-primary-foreground" : "text-muted-foreground")}>{taken ? "Booked" : "60 min · available"}</span>
          </button>; })}</div> : <p className="mt-2 border border-dashed border-border p-4 text-sm text-muted-foreground">Select a date to see available times.</p>}

          <p className="mt-4 text-xs leading-5 text-muted-foreground">Your selected slot is held while your payment is verified. {ACCESS_NOTE}</p>
          <div className="mt-4 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between"><Button variant="outline" onClick={() => setStep(0)}><ArrowLeft/>Change package</Button><Button disabled={!date || !time} onClick={() => setStep(2)}>Continue to payment <ArrowRight/></Button></div>
        </div>}

        {step === 2 && <form noValidate onSubmit={submit} className="border border-border bg-card p-4 sm:p-5">
          <fieldset><legend className="flex items-center gap-2 text-base font-semibold"><span className="grid size-5 place-items-center bg-primary text-[10px] font-bold text-primary-foreground">1</span>Scan &amp; pay with PayNow</legend>
            <div className="mt-3 grid gap-4 sm:grid-cols-[180px_1fr] sm:items-center">
              <div className="mx-auto w-44 border border-border bg-foreground p-2 sm:w-full"><DemoQr seed={reference ?? "velovest"}/><p className="pt-1.5 text-center text-[10px] font-bold uppercase text-background">PayNow · Sample QR</p></div>
              <div className="space-y-2 text-sm">
                <dl className="divide-y divide-border border-y border-border">
                  <div className="flex justify-between gap-3 py-2"><dt className="text-muted-foreground">Amount</dt><dd className="text-lg font-semibold tabular-nums">{formatSGD(packageTotal(pkg), true)} SGD</dd></div>
                  <div className="flex justify-between gap-3 py-2"><dt className="text-muted-foreground">Pay to</dt><dd className="text-right">Velovest</dd></div>
                  <div className="flex justify-between gap-3 py-2"><dt className="text-muted-foreground">Reference</dt><dd className="font-semibold tabular-nums">{reference}</dd></div>
                </dl>
                <ol className="list-decimal space-y-0.5 pl-4 text-xs leading-5 text-muted-foreground"><li>Open your banking app and scan the PayNow QR.</li><li>Check the amount and enter <strong className="text-foreground">{reference}</strong> as the reference.</li><li>Save a screenshot of the successful payment.</li></ol>
              </div>
            </div>
          </fieldset>

          <fieldset className="mt-5 border-t border-border pt-4"><legend className="flex items-center gap-2 text-base font-semibold"><span className="grid size-5 place-items-center bg-primary text-[10px] font-bold text-primary-foreground">2</span>Your details</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Full name" error={errors.name}><input className={field} value={details.name} onChange={e => set("name", e.target.value)} autoComplete="name" aria-invalid={!!errors.name} maxLength={80}/></Field>
              <Field label="Email address" error={errors.email}><input type="email" className={field} value={details.email} onChange={e => set("email", e.target.value)} autoComplete="email" placeholder="you@example.com" aria-invalid={!!errors.email} maxLength={120}/></Field>
              <Field label="Mobile number" optional><input type="tel" className={field} value={details.phone} onChange={e => set("phone", e.target.value)} autoComplete="tel" placeholder="+65" maxLength={20}/></Field>
              <Field label="Bank transaction ID" optional><input className={field} value={details.txn} onChange={e => set("txn", e.target.value)} maxLength={40}/></Field>
            </div>
          </fieldset>

          <fieldset className="mt-5 border-t border-border pt-4"><legend className="flex items-center gap-2 text-base font-semibold"><span className="grid size-5 place-items-center bg-primary text-[10px] font-bold text-primary-foreground">3</span>Upload proof of payment</legend>
            {proof ? <div className="mt-3 flex items-center gap-3 border border-chart-2/50 bg-elevated p-3">
              {proofUrl ? <img src={proofUrl} alt="Proof of payment preview" className="size-14 shrink-0 border border-border object-cover"/> : <FileCheck2 className="size-8 shrink-0 text-chart-2"/>}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{proof.name}</p><p className="text-xs text-muted-foreground">{(proof.size / 1024).toFixed(0)} KB · ready to submit</p></div>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove file" onClick={() => setProof(null)}><X/></Button>
            </div> : <label className={cn("mt-3 flex cursor-pointer flex-col items-center gap-1.5 border border-dashed bg-elevated p-5 text-center transition-colors hover:border-primary/60", errors.proof ? "border-destructive" : "border-border")}>
              <Upload className="size-5 text-primary"/><span className="text-sm font-semibold">Choose a screenshot or PDF</span><span className="text-xs text-muted-foreground">PNG, JPG or PDF · up to 5 MB</span>
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={e => { setProof(e.target.files?.[0] ?? null); clearError("proof"); }}/>
            </label>}
            {errors.proof && <p className="mt-1 text-xs text-destructive">{errors.proof}</p>}
          </fieldset>

          <label className="mt-4 flex items-start gap-2.5 text-xs leading-5 text-muted-foreground"><input type="checkbox" checked={details.agree} onChange={e => set("agree", e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" aria-invalid={!!errors.agree}/><span>I have read the <Link to="/risk-disclosure" className="font-semibold text-primary">Risk Disclosure</Link> and understand that my appointment is confirmed only after payment is verified, and that access to the Velovest system is given during my onboarding session.</span></label>
          {errors.agree && <p className="mt-1 text-xs text-destructive">{errors.agree}</p>}
          <p className="mt-3 border border-warning/40 bg-warning/10 px-3 py-2 text-xs">Demo — the QR is a sample and uploaded files aren’t stored.</p>
          <div className="mt-4 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between"><Button type="button" variant="outline" onClick={() => setStep(1)} disabled={processing}><ArrowLeft/>Change booking</Button><Button type="submit" disabled={processing}>{processing ? <><Loader2 className="animate-spin"/>Submitting…</> : <><Upload/>Submit proof of payment</>}</Button></div>
        </form>}

        <OrderSummary pkg={pkg} date={date} time={time}/>
      </div>}
    </div></section>
  </MarketingLayout>;
}

/* ---------- Proof-of-payment acknowledgement ---------- */

export type Booking = { ref: string; pkg: PackageId; date: string; time: SlotTime; name: string; email: string };

export function CompactConfirmation({ booking }: { booking: Booking | null }) {
  if (!booking) return <MarketingLayout><section className="px-4 py-12 sm:px-6 lg:px-8"><div className="mx-auto max-w-xl border border-border bg-card p-6 text-center">
    <h1 className="text-2xl font-semibold">We couldn’t find that booking.</h1><p className="mt-2 text-sm text-muted-foreground">Start from the pricing page to choose a package and book your onboarding session.</p>
    <Button asChild className="mt-4"><Link to="/pricing">View pricing <ArrowRight/></Link></Button>
  </div></section></MarketingLayout>;

  const { ref, pkg, date, time, name, email } = booking;
  const info = packages[pkg];
  const total = formatSGD(packageTotal(pkg), true);
  const firstName = name.split(" ")[0] || name;
  const rows: Array<[string, ReactNode]> = [
    ["Reference", <span className="tabular-nums">{ref}</span>],
    ["Package", `${info.name} · ${info.tier}`],
    ["Amount", <span className="font-semibold">{total} SGD · PayNow</span>],
    ["Proof of payment", <span className="inline-flex items-center gap-1 text-positive"><CheckCircle2 className="size-3.5"/>Received</span>],
    ["Payment status", <span className="inline-flex items-center gap-1 text-warning"><Hourglass className="size-3.5"/>Pending verification</span>],
    ["Requested session", <>{formatSessionDate(date)}<br/>{formatSlot(time)}</>],
    ["Submitted by", <>{name}<br/><span className="text-muted-foreground">{email}</span></>],
  ];
  const timeline: Array<[string, string, "done" | "now" | "next"]> = [
    ["Proof of payment submitted", "Received just now.", "done"],
    ["Payment verification", VERIFICATION_NOTE, "now"],
    ["Appointment confirmation email", `Sent to ${email} once your payment is verified.`, "next"],
    ["Onboarding session & system access", `${formatSessionDate(date)}, ${formatSlot(time)}. ${ACCESS_NOTE}`, "next"],
  ];

  return <MarketingLayout>
    <section className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8"><div className="mx-auto max-w-6xl">
      <Stepper current={3}/>
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="grid size-12 shrink-0 place-items-center bg-positive/15 text-positive"><FileCheck2 className="size-6"/></span>
        <div><p className={eyebrow}>Payment acknowledgement</p><h1 className="mt-1 text-balance text-2xl font-semibold leading-tight sm:text-4xl">Thank you. We’ve received your proof of payment.</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Thanks, {firstName}. An acknowledgement email has been sent to <span className="font-semibold text-foreground">{email}</span>.</p></div>
      </div>
      <div className="mt-4 flex gap-3 border-l-4 border-warning bg-secondary p-4"><Hourglass className="mt-0.5 size-5 shrink-0 text-warning"/><div><p className="font-semibold">Your payment is being verified.</p><p className="mt-1 text-sm leading-6 text-muted-foreground">You’ll receive an appointment confirmation email once your payment is verified — {VERIFICATION_NOTE.charAt(0).toLowerCase() + VERIFICATION_NOTE.slice(1)} {ACCESS_NOTE}</p></div></div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-4">
          <article className="border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="text-base font-semibold">Submission summary</h2><span className="text-xs text-muted-foreground">{ref}</span></div>
            <dl className="mt-3 divide-y divide-border border-y border-border text-sm">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[140px_1fr] gap-3 py-2.5"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl>
            <div className="mt-4 flex flex-wrap gap-2 print:hidden"><Button variant="outline" onClick={() => window.print()}><Printer/>Print</Button><Button asChild variant="ghost"><Link to="/">Back to home</Link></Button></div>
          </article>
          <article className="border border-border bg-card p-4 sm:p-5"><h2 className="text-base font-semibold">What happens next</h2>
            <ol className="mt-3 space-y-3">{timeline.map(([title, copy, state], index) => <li key={title} className="flex gap-3">
              <span className={cn("grid size-6 shrink-0 place-items-center text-[11px] font-bold", state === "done" ? "bg-positive text-background" : state === "now" ? "bg-warning text-background" : "border border-border text-muted-foreground")}>{state === "done" ? <Check className="size-3.5"/> : index + 1}</span>
              <div><p className={cn("text-sm font-semibold", state === "next" && "text-muted-foreground")}>{title}</p><p className="text-xs leading-5 text-muted-foreground">{copy}</p></div>
            </li>)}</ol>
          </article>
        </div>

        <article className="border border-border bg-elevated" aria-label="Acknowledgement email preview">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs"><Mail className="size-4 text-primary"/><span className="font-semibold">Acknowledgement email</span><span className="ml-auto truncate text-muted-foreground">Sent to {email}</span></div>
          <div className="p-4 sm:p-5">
            <dl className="space-y-1 text-xs"><div className="flex gap-2"><dt className="w-14 text-muted-foreground">From</dt><dd>Velovest Academy</dd></div><div className="flex gap-2"><dt className="w-14 text-muted-foreground">Subject</dt><dd className="font-semibold">We’ve received your proof of payment ({ref})</dd></div></dl>
            <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm leading-6">
              <p>Hi {firstName},</p>
              <p>Thank you for submitting your proof of payment of <strong>{total} SGD</strong> via PayNow for the <strong>{info.name}</strong> package.</p>
              <p>Our team is now verifying your payment. <strong>You will receive an appointment confirmation email once your payment is verified — normally within 3 working hours.</strong></p>
              <p className="border-l-2 border-primary bg-card px-3 py-2">Requested onboarding session<br/><strong>{formatSessionDate(date)}</strong><br/>{formatSlot(time)}</p>
              <p>{ACCESS_NOTE}</p>
              <p className="text-muted-foreground">Reference: {ref}</p>
              <p>Thank you,<br/>The Velovest team</p>
            </div>
          </div>
        </article>
      </div>
      <p className="mt-4 text-[10px] leading-4 text-muted-foreground">Prototype preview: no payment was processed, no file was stored and no email was sent. Velovest provides education and software tools only — not investment advice.</p>
    </div></section>
  </MarketingLayout>;
}
