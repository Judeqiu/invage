# Velovest Academy website — developer & AI-agent handoff

This folder is the complete source of the Velovest Academy marketing site and
sign-up journey (pricing → package → onboarding booking → PayNow payment →
payment acknowledgement).

**Everything visual is finished. The sign-up journey is a client-side
prototype:** no booking is saved, no proof-of-payment file is stored, and no
email is sent. Section 4 lists exactly what still needs to be built. Read all
of it before you change code.

---

## 1. Stack and commands

| Item | Value |
| --- | --- |
| Framework | TanStack Start v1 (React 19, file-based routing in `src/routes/`) |
| Build tool | Vite, via `@lovable.dev/vite-tanstack-config` (an ordinary npm package that wraps TanStack Start, React, Tailwind, path aliases and Nitro) |
| Styling | Tailwind CSS v4. All theme colours are tokens in `:root` in `src/styles.css` |
| Language | TypeScript (strict) |
| Tests | Vitest: `src/lib/compact-checkout.test.ts` |
| Package manager | Bun (`bun.lock`); npm also works |

```sh
bun install        # or: npm install
bun run dev        # local dev server
bun run test       # pricing + booking rule tests (must stay green)
bun run build      # production build → dist/ (client in dist/client, server in dist/server)
```

### Hosting target

The build uses Nitro. Without configuration it targets **Cloudflare Workers**
(`cloudflare-module`), and auto-detects Vercel, Netlify or Cloudflare Pages
when built on those platforms. To pin another host, set it in `vite.config.ts`:

```ts
export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  nitro: { preset: "node-server" }, // or "vercel", "netlify", "cloudflare-module", ...
});
```

Alternatively, set the `NITRO_PRESET` environment variable at build time.
Server code must be compatible with the chosen runtime. On Cloudflare Workers
that means Web APIs (`fetch`, `crypto.subtle`) and no Node-only libraries.

### Before going live

- Replace `https://options-clarity-ai.lovable.app` with the real domain in
  `src/routes/sitemap[.]xml.ts` (`BASE_URL`) and `public/robots.txt`.
- Logos are real PNGs in `src/assets/` (`velovest-logo-dark.png` is used in
  header/footer, `velovest-logo-light.png` is a spare for light backgrounds).
  The favicon is `public/favicon.png`.

---

## 2. Site map

| URL | File | Notes |
| --- | --- | --- |
| `/` | `src/routes/index.tsx` | Homepage |
| `/product`, `/for-traders`, `/integrations`, `/resources`, `/risk-disclosure` | `src/routes/*.tsx` | Secondary pages; copy in `src/components/site-content.ts` |
| `/pricing` | `src/routes/pricing.tsx` | Three packages + comparison table |
| `/signup?package=novice\|experienced\|renewal` | `src/routes/signup.tsx` | 3-step checkout (`CompactCheckout` in `src/components/compact-checkout.tsx`) |
| `/confirmation?...` | `src/routes/confirmation.tsx` | Payment acknowledgement page (`CompactConfirmation`) |
| `/login` | `src/routes/login.tsx` | Visual only, not connected to any auth |
| `/compact/*`, `/academy/*`, `/clarity/*`, `/editorial/*`, `/signal/*` | `*.$.tsx` | Redirects for old shared links. Keep them. |
| `/sitemap.xml` | `src/routes/sitemap[.]xml.ts` | Generated sitemap |

Shared header/footer: `src/components/marketing-shell.tsx`.

---

## 3. Business rules (do not change without the owner's approval)

- **Package prices are in SGD and must be labelled "SGD"** (e.g. "$1,080 SGD"):
  - New to Options (Novice): **$1,080 SGD**, one-time
  - Advanced Beginner (Experienced): **$720 SGD**, one-time
  - Yearly Renewal: **$228 SGD** per year
- **Never show per-line-item prices to customers.** `serviceItems[].prices` in
  `src/lib/compact-checkout.ts` exists only so the totals add up. Customers see
  only "included / not included" and the package total.
- All other dollar figures on the site (demo dashboards etc.) are USD and shown
  with a plain `$`, never `S$`.
- Prices, slot times and helpers are defined once in
  `src/lib/compact-checkout.ts`. Server code must import from there too, not
  re-declare prices.
- Onboarding sessions: **60 minutes, Singapore time (SGT, UTC+8), weekdays
  only, starting the next Singapore day**. Slot times are `10:00, 11:00, 14:00,
  15:00, 16:00, 17:00`. Confirm the real hours with the owner.
- Payment verification promise: **"Normally within 3 working hours."**
  (`VERIFICATION_NOTE`).
- Customer access message, used everywhere: **"Access to the Velovest system
  will be given during your onboarding session."**
- Font stack everywhere: `"Proxima Nova", Arial, Verdana, sans-serif`. Proxima
  Nova is not bundled. Add licensed web-font files if the owner has them.
- Velovest provides education and software tools only, not investment advice.
  Keep all risk and disclaimer copy.

---

## 4. What still needs to be built (TODO for the AI agent)

The UI for every step exists. Connect it to a real backend. Suggested order:

### 4.1 Backend: bookings, payment proofs and slot availability

1. **Database table `bookings`** (any SQL/Postgres provider), for example:
   `id`, `reference` (unique, format `VV-XXXXXX`, generated by
   `createReference()`), `package_id`, `amount_sgd` (computed on the server with
   `packageTotal()`, never sent from the browser), `session_date`
   (YYYY-MM-DD), `session_time` (one of `SLOT_TIMES`), `customer_name`,
   `customer_email`, `customer_phone`, `bank_txn_id`, `proof_file_path`,
   `status` (`pending_verification` → `confirmed` | `rejected` | `cancelled`),
   `created_at`, `verified_at`, `verified_by`.
2. **Unique slot constraint.** Allow at most one active booking (pending or
   confirmed) per `session_date + session_time`. That prevents double booking.
3. **Proof-of-payment storage.** Use a **private** bucket (images or PDF, max
   5 MB, the same limits the form already checks). Admins get a short-lived
   signed link. Never use a public URL.
4. **Real availability.** Replace the demo `isSlotTaken()` in
   `src/lib/compact-checkout.ts` with a server call that returns booked slots
   for the shown dates. Optionally also block times that are busy in the
   admin's calendar (see 4.4).
5. **Submit endpoint.** In `CompactCheckout.submit()`
   (`src/components/compact-checkout.tsx`) the code currently waits 1.2 s and
   then navigates. Replace this with a server function or `POST` route that
   does the following, all on the server:
   - validates every field again and checks the slot is still free
   - stores the file and inserts the booking
   - sends emails **A** and **B** below
   - returns the `reference`
   Add basic rate limiting or a bot check, because the form is public.
6. **Confirmation page.** It currently reads name, email and booking details
   from URL query parameters. Change it to `/confirmation?ref=VV-XXXXXX` and
   load the booking on the server. Don't put personal data in URLs.
7. **Real PayNow QR.** Replace the `DemoQr` component with the owner's real
   PayNow QR (static image, or a dynamic SGQR with the amount and reference).
   Set the real "Pay to" name, currently `Velovest`. Remove the "Demo — the QR
   is a sample" notice and the "Prototype preview" footnote on the
   confirmation page.

### 4.2 Email setup (required)

Choose a transactional email provider (e.g. Resend, Postmark, SendGrid, Amazon
SES, or the host's built-in email service). Then:

- Verify a sending domain the owner controls (SPF, DKIM, DMARC), e.g.
  `notify.velovest.ai`. The From name shown in the design is **"Velovest
  Academy"**.
- Store keys as server-only environment variables. Never expose them to the
  browser and never prefix them with `VITE_`.
- Send only from server code, with one recipient per send. Use the booking
  reference plus the email type as the idempotency key, so retries don't send
  duplicates.
- **Do not attach the customer's proof-of-payment file to emails.** Link to it
  through the admin view or a signed URL instead.

Suggested environment variables:

| Variable | Purpose |
| --- | --- |
| `EMAIL_API_KEY` | Email provider API key |
| `EMAIL_FROM` | e.g. `Velovest Academy <noreply@notify.velovest.ai>` |
| `ADMIN_EMAIL` | Administrator inbox(es) that receive booking notifications |
| `DATABASE_URL` / provider keys | Bookings database |
| `STORAGE_*` | Private file storage for payment proofs |
| `ADMIN_*` | Admin login (see 4.3) |
| `CALENDAR_*` | Optional calendar integration (see 4.4) |

#### Email A: Customer acknowledgement (sent right after "Submit proof of payment")

The exact design is previewed on the confirmation page (`CompactConfirmation`):

> **From:** Velovest Academy
> **Subject:** We've received your proof of payment ({reference})
>
> Hi {first name},
>
> Thank you for submitting your proof of payment of **{total} SGD** via PayNow
> for the **{package name}** package.
>
> Our team is now verifying your payment. **You will receive an appointment
> confirmation email once your payment is verified — normally within 3 working
> hours.**
>
> Requested onboarding session: **{weekday, d Month yyyy}**, {h:mm AM – h:mm PM SGT}
>
> Access to the Velovest system will be given during your onboarding session.
>
> Reference: {reference}
>
> Thank you,
> The Velovest team

Use `formatSessionDate()`, `formatSlot()`, `formatSGD()`, `packageTotal()` and
`packages[id].name` from `src/lib/compact-checkout.ts` so the email matches the
site exactly.

#### Email B: Administrator notification with calendar invite (sent at the same time as A)

To `ADMIN_EMAIL`:

- **Subject:** `New booking – payment to verify: {reference} · {package} · {date} {time} SGT`
- **Body:** customer name, email, phone, bank transaction ID, package, amount
  in SGD, requested session date and time (SGT), submission time, a
  link to view the proof of payment (signed or admin-only), and
  **Verify payment** / **Reject** links into the admin view (4.3).
- **Calendar invite:** attach an `.ics` file (`text/calendar; method=REQUEST`)
  generated with the existing `buildIcs({ date, time, reference, packageName })`
  in `src/lib/compact-checkout.ts`. Mark it *tentative / pending payment* so the
  slot shows in the admin's calendar immediately. Extend `buildIcs` with
  `ORGANIZER`, `ATTENDEE`, `STATUS:TENTATIVE`, `SEQUENCE`, and a `METHOD`
  line so calendar apps handle updates. Keep the `UID`
  (`{reference}@velovest.ai`) stable, so later updates replace the same event.

#### Email C: Customer appointment confirmation (sent when admin verifies payment)

- **Subject:** `Your Velovest onboarding session is confirmed ({reference})`
- **Body:** payment verified, package, amount in SGD, confirmed session date and
  time in SGT, how to join (video meeting link or address, which the owner must
  supply), what to prepare, and *"Access to the Velovest system will be given
  during your onboarding session."*
- **Attach `.ics`** (same `UID`, `STATUS:CONFIRMED`, higher `SEQUENCE`) so the
  customer can add it to their calendar.
- Also send the admin an updated `.ics` (same `UID`, `STATUS:CONFIRMED`) so
  their calendar event changes from tentative to confirmed.

#### Email D: Payment could not be verified (optional, on reject)

Ask the customer to re-check the transfer or contact support. Release the slot,
and send the admin a `.ics` with `METHOD:CANCEL` (same `UID`).

### 4.3 Admin verification view (required for Email C)

Add a protected admin page, e.g. `/admin/bookings`, behind a real login. Check
roles on the server, not only in the UI. It should list bookings by status, show
the proof of payment, and offer **Verify** and **Reject** actions. Verify sets
`status = confirmed` and sends Email C. Reject sends Email D. Verify/Reject
links in Email B must require the admin to be signed in. Never use an
unauthenticated one-click link that changes status.

### 4.4 Calendar integration (optional, recommended)

The `.ics` attachments in B and C cover the basics. For a two-way sync:

- **Google Calendar / Microsoft 365 API:** when a booking is created, create a
  tentative event on the admin's calendar. Mark it confirmed on Verify and
  delete it on Reject. When showing available slots, also check the calendar's
  free/busy times so the site never offers a time the admin is busy.
- **Or Cal.com / Calendly:** replace the custom slot picker with their embed or
  API. Keep the SGT weekday rules and the "booking held until payment is
  verified" behaviour.

### 4.5 Login (`/login`)

This page is visual only. Connect it to the Velovest dashboard's real sign-in,
or link it to the existing dashboard URL. Customers get access during their
onboarding session, so self-sign-up should not grant dashboard access.

---

## 5. Acceptance checklist

- [ ] `bun run test` passes. Add tests for any new pricing or booking rules.
- [ ] Two people cannot book the same date and time.
- [ ] Submitting the form stores the booking and the proof file privately.
- [ ] The customer receives Email A within a minute; the admin receives Email B
      with a working `.ics` that appears in Google Calendar and Outlook.
- [ ] Admin Verify sends Email C (with `.ics`) and updates the admin's calendar
      event to confirmed. Reject sends Email D and frees the slot.
- [ ] The confirmation page loads by `ref` only, with no personal data in the URL.
- [ ] Real PayNow QR and "Pay to" name are shown, and the demo notices are removed.
- [ ] All prices show "SGD", and no line-item prices are visible anywhere.
- [ ] Sitemap and robots use the production domain.
- [ ] Pages checked at 1440×900 (16:10), 1440×810 (16:9) and 390×844 (mobile).

## 6. Information the owner still needs to provide

- PayNow QR image or UEN, and the exact "Pay to" name
- Administrator email address(es) for booking notifications
- Real onboarding hours and days, and any public holidays to block
- Meeting link or location for onboarding sessions
- Sending domain for emails (e.g. `velovest.ai`) and DNS access
- Whether Yearly Renewal customers should skip the booking step
