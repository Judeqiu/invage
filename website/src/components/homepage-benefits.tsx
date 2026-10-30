import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const benefits = [
  ["Structured Risk Management", "for total capital control"],
  ["Personal AI Guidance", "built directly into your workflow"],
  ["Intuitive Velovest Dashboard", "for confident decision-making"],
] as const;

export function HomepageBenefits({ centered = false }: { centered?: boolean }) {
  return <div className={cn("mt-5 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7", centered && "mx-auto")}>
    <p>Move beyond speculative trading and run a systematic options business.</p>
    <ul aria-label="Velovest benefits" className={cn("mt-3 space-y-2 text-left", centered && "mx-auto w-fit")}>
      {benefits.map(([title, copy]) => <li key={title} className="flex items-start gap-2">
        <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary"/>
        <span><strong className="font-semibold text-foreground">{title}</strong> {copy}</span>
      </li>)}
    </ul>
  </div>;
}