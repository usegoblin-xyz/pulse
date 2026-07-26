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

export interface SearchConfig { provider: "tavily" | "ddg"; apiKey: string; }
export function searchConfigFromEnv(env = process.env): SearchConfig {
  const apiKey = env.PULSE_SEARCH_API_KEY || "";
  const provider = (env.PULSE_SEARCH_PROVIDER as "tavily" | "ddg") || (apiKey ? "tavily" : "ddg");
  return { provider, apiKey };
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// DuckDuckGo's HTML endpoint wraps outbound links in a redirect; pull the real
// URL out of the uddg query param when present.
function unwrapDdg(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { /* fall through */ } }
  return href.startsWith("//") ? "https:" + href : href;
}

async function searchDdg(query: string, max: number): Promise<SearchResponse> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, accept: "text/html" },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!res.ok) throw new Error(`ddg ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  // Each result: <a ... class="result__a" href="HREF">TITLE</a> ... <a class="result__snippet">SNIP</a>
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snips: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snipRe.exec(html))) snips.push(stripTags(sm[1]));
  let lm: RegExpExecArray | null; let i = 0;
  while ((lm = linkRe.exec(html)) && results.length < max) {
    const url = unwrapDdg(lm[1]);
    const title = stripTags(lm[2]);
    if (!title || !/^https?:\/\//.test(url)) { i++; continue; }
    results.push({ title, url, snippet: snips[i] || "" });
    i++;
  }
  return { results, provider: "duckduckgo" };
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
  if (cfg.provider === "tavily" && cfg.apiKey) {
    try { return await searchTavily(q, max, cfg.apiKey); }
    catch (e: any) { console.error("[search] tavily failed, falling back to ddg:", e?.message ?? e); }
  }
  return searchDdg(q, max);
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
