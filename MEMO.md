# Product Memo: Settlement Engine — Vs Deal & Transparent Worksheet

**To:** Pri Shankar (CEO) and the Greenroom Product Team  
**From:** Applied AI PM Candidate  
**Date:** May 2025  
**Re:** Closing the 63% spreadsheet gap — slice rationale, what was built, and what's next

---

## The Problem

Greenroom's in-app settlement tool handles 37% of deals. The other 63% — predominantly vs deals — push Mariana to a Google Sheet at 2am the night of the show.

This isn't a usage problem. The interviews make clear that Mariana would prefer to stay in Greenroom. She opened two tabs in every session: Greenroom for deal context, Google Sheets for the math. She left Greenroom not because she wanted to, but because she had to.

The CEO memo frames this correctly: settlement is trust-critical. Every spreadsheet handoff is a moment where the venue's product fails the booker, and by extension, fails the artist team reviewing the numbers. Marcus estimates the downstream cost of one bad settlement — a routing agent who avoided The Crescent — at roughly $80K in lost bookings over a year.

---

## Why This Slice

Settlement isn't one problem. The starter repo surfaces at least four distinct problems, each of which could anchor a slice:

**1. The calculator can't handle most deal types.** 63% of deals return "unsupported." Mariana does the math in a spreadsheet and pastes the result back in. The data to run the calculation exists in the system — the engine just doesn't know what to do with it.

**2. The structured fields don't reflect what was actually negotiated.** Mariana enters deals as prose because the form fields don't model the nuance. The freetext is the truth; the structured fields are an approximation. This creates a silent drift problem where the calculator runs on wrong inputs.

**3. The artist team can't see the math behind the number.** Diego (tour manager) signs under load-out pressure because he can't trace the numbers back. Sarah Kim (WME) wants to review before Diego is in the room. There's no shared view, no transparency layer, no paper trail that travels with the settlement.

**4. Disputes resolve off-system.** The Coastal Spell thread shows a $720 concession made over email. The system has no record of how it was resolved. This creates a data integrity gap that compounds over time.

I chose slice 1 — the calculator — for three reasons:

First, it's the structural unblock. Slices 2, 3, and 4 all assume correct numbers exist. A shared agent view of a wrong settlement number is worse than no shared view. A dispute resolution flow upstream of a calculation error doesn't fix the calculation. The calculator is the foundation everything else depends on.

Second, the data is already there. Ticket sales, expenses, deal terms — all in the system, all queryable. This isn't a data collection problem or a behavioral problem. It's a missing formula. The fix is contained and the impact is immediate: one PR moves coverage from 37% to 94%.

Third, it's the trust-critical moment. Pri's memo is right that settlement is where craft matters most. When Mariana hands Diego a number at 2am, that number needs to be traceable. A worksheet he can read is the foundation of trust. Everything else — shared links, advance confirmation, dispute flows — is built on top of a number both sides believe.

Slice 2 (freetext sync) became the AI audit card — a secondary feature that catches structured field drift without requiring a form redesign. Slices 3 and 4 are "What's Next."

---

## Why Vs Deals First

Of the 537 deals in the database: 188 are vs, 119 are percentage-of-net, 30 are door, and the remaining 200 are already handled. Vs deals are 35% of all deals and the single largest unsupported category. Percentage-of-net comes second.

More importantly: vs deals are the most opaque. The math isn't just "apply the formula" — it requires choosing between two paths (guarantee vs % of net) and showing which one won and why. That choice is exactly what agents like Sarah Kim dispute. She described good settlement statements as requiring three things: **itemization, provenance, and tone**. The current tool's empty state provides none of these.

Door deals were de-prioritized. There are only 30 in the database, the schema doesn't carry a structured door-specific field (percentage lives in the same column as other deal types), and the logic varies enough by deal that freetext prose is usually authoritative. Better to get it right for the 307 vs/net deals than rush the 30 door ones.

---

## What Was Built

**`lib/dealMath.ts` — extended to handle vs and percentage_of_net**

Both deal types now return a `supported: true` result with a full step-by-step worksheet. For vs deals, the worksheet shows both paths explicitly — the guarantee floor and the percentage-of-net calculation — then labels which one applies and why. A booker can hand this to a tour manager and answer "why did you pay me $54,400?" without opening a spreadsheet.

Coverage: 37% → 94% of deals now settleable in-app (507/537). Only door deals remain out-of-scope (30 deals, 6%).

**`app/shows/[id]/settle/page.tsx` — data integrity audit flag**

While querying the database, a second bug surfaced: 23 settlements are marked `paid` or `finalized` but still carry recoups with `status: "disputed"` in the JSON. This means the dispute was resolved off-system (likely by phone or email) and nobody logged the resolution in Greenroom. The system has no record of what was agreed.

The settle page now surfaces this as an amber audit flag: *"settlement marked paid with N unresolved recoup disputes — the dispute was likely settled by phone or email, and the system has no record of it."*

This isn't a UX feature. It's a data quality signal that makes the invisible visible. Mariana's frustration — "there's no version of the truth in our system" — is exactly this pattern. Twenty-three shows where the agreed number exists only in someone's memory.

---

## What Was Cut and Why

**Comps that count toward gross.** The schema has a `countsTowardGross` boolean on the comps table. The settlement engine ignores it. For most deal types this doesn't affect the payout number (flat guarantees don't care about gross), but for percentage-of-gross deals it can. This was intentionally deferred — it requires surfacing a new concept in the UI ("these 12 comp tickets are being counted in your gross") that needs design work, not just math. The bug exists today too; fixing it now would obscure the bigger coverage gain.

**Freetext bonus parsing.** About half the deals with bonuses put them only in `dealNotesFreetext`. The engine reads `bonusesJson` only. An AI extraction layer could parse the freetext and populate structured fields — this would make bonuses visible to the engine for the full 50% of deals that currently hide them in prose. This is a good second-order AI PM problem, but it requires confidence in the parser accuracy before it affects money-out numbers. Not a week-one ship.

**Tier ratchets.** The schema supports them; the engine explicitly flags them as not-handled. They're complex (the percentage itself is a function of gross tier), rare, and closely tied to vs-deal structure. They're now unblocked architecturally — the vs deal path is the right host for them — but the UI would need to show the ratchet bands, not just a single %. Punted to a follow-on iteration.

**The "preview before the tour manager signs" flow.** Diego (TM) said he sometimes signs when uncertain because load-out pressure is real. Sarah Kim (WME) explicitly wants a preview capability so she can review before Diego is in the room. This is a product surface that doesn't exist at all yet — it would need a shared link, read-only settlement view, and possibly a comment/approval flow. It's the right next product bet; it just doesn't belong in the same PR as the math engine.

---

## What I'd Validate Before Shipping

1. **Run the engine against 5-10 past vs deals that were settled off-platform.** Compare `totalToArtist` from `calculateSettlement()` against the `total_to_artist` logged in the settlements table. If they diverge systematically, find out why — likely a recoup being applied before the vs comparison in some deals, which isn't how the engine currently works.

2. **Confirm expense cap behavior.** The schema has `expenseCap` and `hospitalityCap` on deals. Some deal notes freetext references expense caps. The engine doesn't enforce them — it passes all non-absorbed expenses through. This may cause over-deduction in percentage-of-net and vs deals if the expense cap limits what can be deducted. Needs a data check before showing numbers to agents.

3. **Show the worksheet to Mariana before shipping.** She's the primary user. The step layout, the "winner" language for vs deals, the note text — all of this is guesswork until she reacts to it. One 20-minute session would confirm or break the design.

---

## What's Next

The two-tab problem (Greenroom + spreadsheet) is now mostly solved for the math. The next layer of the problem — from the interviews — is the **paper trail**:

- Mariana needs proof of what was agreed at signing time, not just the math at settlement time.
- Sarah Kim needs to see deal terms both sides agreed to, not just the venue's settlement document.
- Marcus needs to know Wednesday if Friday's deal will be messy.

This points toward a deal-term confirmation flow earlier in the show lifecycle (at advance, not at settlement) and a shared settlement view that both the venue and artist team can access. The transparent worksheet built here is the foundation — once the math is trustworthy and visible, the paper trail problem becomes tractable.

---

*Branch: `feat/vs-deal-calculator` on `github.com/00umar/greenroom-starter`*
