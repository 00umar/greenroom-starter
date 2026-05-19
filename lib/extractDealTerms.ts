/**
 * AI-powered extraction of deal terms from `dealNotesFreetext`.
 *
 * Mariana trusts the freetext more than the structured fields — it's what she
 * actually wrote at signing time. This function uses an LLM to pull structured
 * terms out of the prose and compare them against the DB fields. Mismatches
 * are the interesting signal: they mean the structured record and the agreed
 * terms diverged at some point, silently.
 *
 * Requires GROQ_API_KEY in the environment. Returns { ok: false } with a
 * typed reason so the UI can degrade gracefully without crashing.
 */

import type { Deal } from "@/db/schema";

export type ExtractedTerms = {
  dealType?: "flat" | "vs" | "percentage_of_net" | "percentage_of_gross" | "door";
  guaranteeAmount?: number;
  percentage?: number;
  expenseCap?: number;
  bonusMentions: string[];
  confidence: "high" | "medium" | "low";
};

export type TermsMismatch = {
  field: string;
  structured: string;
  extracted: string;
  note: string;
};

export type ExtractionResult =
  | { ok: true; terms: ExtractedTerms; mismatches: TermsMismatch[] }
  | { ok: false; reason: "no_key" | "api_error" | "parse_error" };

const SYSTEM_PROMPT = `You are parsing deal notes for a live music venue booking system. Extract structured deal terms from free-text prose.

Return ONLY a JSON object — no explanation, no markdown. Use this schema (omit fields you cannot determine with confidence):
{
  "dealType": "flat" | "vs" | "percentage_of_net" | "percentage_of_gross" | "door" | null,
  "guaranteeAmount": number | null,
  "percentage": number | null,
  "expenseCap": number | null,
  "bonusMentions": string[],
  "confidence": "high" | "medium" | "low"
}

Rules:
- percentage should be a decimal (0.85 for 85%, 0.9 for 90%)
- dollar amounts should be plain numbers without formatting (54000, not $54,000)
- "vs deal" / "versus" maps to dealType "vs"
- "percentage of net" / "% of net" maps to "percentage_of_net"
- "flat guarantee" / "flat" maps to "flat"
- bonusMentions: brief string per bonus found in the text, e.g. ["sellout bonus $2,500", "gross threshold $80k → $1,500"]
- confidence: "high" if 2+ deal terms found clearly, "medium" if 1 term found, "low" if text is vague`;

function safeParseJSON(text: string): ExtractedTerms | null {
  try {
    return JSON.parse(text) as ExtractedTerms;
  } catch {
    // AI sometimes wraps JSON in backticks or adds a prefix — strip and retry
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as ExtractedTerms;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function extractDealTerms(
  freetext: string,
  deal: Deal,
): Promise<ExtractionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "no_key" };
  }

  let terms: ExtractedTerms;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Deal notes:\n${freetext}` },
        ],
        max_tokens: 512,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      return { ok: false, reason: "api_error" };
    }

    const data = (await response.json()) as {
      choices?: { message?: { content: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJSON(text);
    if (!parsed) return { ok: false, reason: "parse_error" };
    terms = parsed;
  } catch {
    return { ok: false, reason: "api_error" };
  }

  const mismatches: TermsMismatch[] = [];

  if (terms.dealType && terms.dealType !== deal.dealType) {
    mismatches.push({
      field: "Deal type",
      structured: deal.dealType,
      extracted: terms.dealType,
      note: "The freetext describes a different deal structure than the structured field. One may have been updated without syncing the other.",
    });
  }

  if (
    terms.guaranteeAmount != null &&
    deal.guaranteeAmount != null &&
    Math.abs(terms.guaranteeAmount - deal.guaranteeAmount) > 100
  ) {
    mismatches.push({
      field: "Guarantee",
      structured: `$${deal.guaranteeAmount.toLocaleString()}`,
      extracted: `$${terms.guaranteeAmount.toLocaleString()}`,
      note: "The guarantee in the deal notes doesn't match the structured guarantee field. The agent's % calc depends on this number.",
    });
  }

  if (
    terms.percentage != null &&
    deal.percentage != null &&
    Math.abs(terms.percentage - deal.percentage) > 0.005
  ) {
    mismatches.push({
      field: "Percentage",
      structured: `${(deal.percentage * 100).toFixed(0)}%`,
      extracted: `${(terms.percentage * 100).toFixed(0)}%`,
      note: "The percentage in the deal notes differs from the structured field. This affects the artist payout calculation directly.",
    });
  }

  if (
    terms.expenseCap != null &&
    deal.expenseCap == null
  ) {
    mismatches.push({
      field: "Expense cap",
      structured: "none in structured field",
      extracted: `$${terms.expenseCap.toLocaleString()}`,
      note: "The freetext mentions an expense cap that isn't recorded in the structured field. The settlement engine doesn't enforce it.",
    });
  }

  return { ok: true, terms, mismatches };
}
