// Pulse's research faculty: search the web, and read a page in full.
//
//   search(query)   -> { answer?, results: [{ title, url, snippet }] }
//   readPage(url)   -> { url, title, text, screenshot }
//
// Search is provider-agnostic. With PULSE_SEARCH_API_KEY set it uses Tavily (an
// AI-native search API with a generous free tier that returns clean content and
// a synthesized answer). With no key it falls back to keyless DuckDuckGo HTML,
// so the demo works out of the box. Reading reuses the shared Playwright browser
// (browser.ts) to load the page and pull out its readable text plus a snapshot.

import { getBrowser } from "./browser.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface SearchResult { title: string; url: string; snippet: string; }
export interface SearchResponse { answer?: string; results: SearchResult[]; provider: string; }

export type SearchProvider = "nimble" | "tavily" | "wikipedia";
export interface SearchConfig { provider: SearchProvider; nimbleKey: string; tavilyKey: string; }
export function searchConfigFromEnv(env = process.env): SearchConfig {
  const nimbleKey = env.PULSE_NIMBLE_API_KEY || "";
  const tavilyKey = env.PULSE_SEARCH_API_KEY || "";
  const provider =
    (env.PULSE_SEARCH_PROVIDER as SearchProvider) ||
    (nimbleKey ? "nimble" : tavilyKey ? "tavily" : "wikipedia");
  return { provider, nimbleKey, tavilyKey };
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Keyless fallback that works from a datacenter IP. Web search engines
// (DuckDuckGo, Google, Bing) all challenge server traffic, so the zero-config
// path uses Wikipedia's open search API — narrow, but reliable and enough for
// factual questions, and it pairs with readPage (which loads any real page).
async function searchWikipedia(query: string, max: number): Promise<SearchResponse> {
  const api =
    "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1" +
    `&srlimit=${max}&srsearch=${encodeURIComponent(query)}`;
  const res = await fetch(api, { headers: { "user-agent": "PulseResearch/1.0 (pulse-demo.fly.dev)", accept: "application/json" } });
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  const data: any = await res.json();
  const hits: any[] = Array.isArray(data?.query?.search) ? data.query.search : [];
  const results: SearchResult[] = hits.slice(0, max).map((h) => ({
    title: String(h?.title || ""),
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(h?.title || "").replace(/ /g, "_")),
    snippet: stripTags(String(h?.snippet || "")),
  }));
  return { results, provider: "wikipedia" };
}

// Nimble's SERP API: real Google-backed results, served through Nimble's own
// network, so it works from a datacenter where the search engines block us.
async function searchNimble(query: string, max: number, apiKey: string): Promise<SearchResponse> {
  const res = await fetch("https://sdk.nimbleway.com/v2/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: max }),
  });
  if (!res.ok) throw new Error(`nimble ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data: any = await res.json();
  const results: SearchResult[] = (Array.isArray(data?.results) ? data.results : [])
    .slice(0, max)
    .map((r: any) => ({
      title: String(r?.title || ""),
      url: String(r?.url || ""),
      snippet: String(r?.description || r?.content || "").slice(0, 400),
    }))
    .filter((r: SearchResult) => r.url);
  return { results, provider: "nimble" };
}

async function searchTavily(query: string, max: number, apiKey: string): Promise<SearchResponse> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: max,
      search_depth: "basic",
      include_answer: true,
    }),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data: any = await res.json();
  const results: SearchResult[] = (Array.isArray(data?.results) ? data.results : [])
    .slice(0, max)
    .map((r: any) => ({ title: String(r?.title || ""), url: String(r?.url || ""), snippet: String(r?.content || "").slice(0, 400) }))
    .filter((r: SearchResult) => r.url);
  return { answer: data?.answer ? String(data.answer) : undefined, results, provider: "tavily" };
}

export async function search(query: string, cfg: SearchConfig, max = 6): Promise<SearchResponse> {
  const q = (query || "").trim();
  if (!q) return { results: [], provider: cfg.provider };
  // Try the configured live-web provider first; fall back to Wikipedia (keyless,
  // datacenter-friendly) if it errors, so search never goes fully dark.
  if (cfg.provider === "nimble" && cfg.nimbleKey) {
    try { return await searchNimble(q, max, cfg.nimbleKey); }
    catch (e: any) { console.error("[search] nimble failed, falling back:", e?.message ?? e); }
  }
  if (cfg.provider === "tavily" && cfg.tavilyKey) {
    try { return await searchTavily(q, max, cfg.tavilyKey); }
    catch (e: any) { console.error("[search] tavily failed, falling back:", e?.message ?? e); }
  }
  return searchWikipedia(q, max);
}

// --- reading a page in full ---

export interface ReadResult { url: string; title: string; text: string; screenshot: string; }

// Runs in the page: strip chrome, prefer the main article, return readable text.
function extractReadable(): { title: string; text: string } {
  const drop = ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "iframe"];
  const root = (document.querySelector("article") || document.querySelector("main") || document.body) as HTMLElement;
  const clone = root.cloneNode(true) as HTMLElement;
  drop.forEach((sel) => clone.querySelectorAll(sel).forEach((n) => n.remove()));
  const text = (clone.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { title: document.title || "", text };
}

export async function readPage(url: string): Promise<ReadResult> {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1000, height: 1100 } });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(700);
    const { title, text } = await page.evaluate(extractReadable);
    let screenshot = "";
    try {
      screenshot = "data:image/jpeg;base64," + (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64");
    } catch { /* page still painting; text is what matters */ }
    return { url, title: title || url, text: text.slice(0, 9000), screenshot };
  } finally {
    await context.close().catch(() => {});
  }
}
