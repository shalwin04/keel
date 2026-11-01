import { readMedia } from "./media.ts";

type Page = { setContent(html: string, o?: object): Promise<void>; screenshot(o?: object): Promise<Buffer>; close(): Promise<void>; waitForTimeout(ms: number): Promise<void> };
type Browser = { newPage(o?: object): Promise<Page>; close(): Promise<void> };

let browser: Promise<Browser> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;

async function getBrowser(): Promise<Browser> {
  browser ??= (async () => {
    const pw = (await import(/* @vite-ignore */ "playwright" as string)) as { chromium: { launch(o?: object): Promise<Browser> } };
    return pw.chromium.launch({ args: ["--no-sandbox"] });
  })().catch((err) => { browser = undefined; throw new Error(`Rendering needs Playwright's Chromium (npx playwright install chromium): ${(err as Error).message.split("\n")[0]}`); });
  return browser;
}

/** Image refs inside a design become data URIs so the headless page needs no network or file access. */
export async function inlineImageHref(ref: string): Promise<string> {
  if (ref.startsWith("data:")) return ref;
  const m = await readMedia(ref);
  return `data:${m.mime};base64,${m.bytes.toString("base64")}`;
}

/** Renders an SVG (Studio design) to a PNG at its native size. One shared headless browser, closed after 2 idle minutes. */
export async function renderSvgToPng(svg: string, w: number, h: number): Promise<Buffer> {
  const b = await getBrowser();
  if (idle) clearTimeout(idle);
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style></head><body>${svg}</body></html>`, { waitUntil: "load" });
    await page.waitForTimeout(50);
    return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } });
  } finally {
    await page.close();
    idle = setTimeout(() => { void browser?.then((x) => x.close()); browser = undefined; }, 120_000);
    idle.unref?.();
  }
}

/** Screenshots a web page (an Ad Library snapshot, say) as PNG. Waits for images; gives up after 25 s. */
export async function captureUrl(url: string, o: { width?: number; height?: number } = {}): Promise<Buffer> {
  const b = await getBrowser();
  if (idle) clearTimeout(idle);
  const page = (await b.newPage({ viewport: { width: o.width ?? 500, height: o.height ?? 900 }, deviceScaleFactor: 2 })) as Page & { goto(u: string, o?: object): Promise<unknown> };
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 });
    await page.waitForTimeout(500);
    return await page.screenshot({ type: "png", fullPage: false });
  } finally {
    await page.close();
    idle = setTimeout(() => { void browser?.then((x) => x.close()); browser = undefined; }, 120_000);
    idle.unref?.();
  }
}

/** A fresh page in the shared headless browser, closed afterwards. For crawling (site reading) and screenshots. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withPage<T>(o: { width?: number; height?: number; scale?: number }, fn: (page: any) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  if (idle) clearTimeout(idle);
  const page = await b.newPage({ viewport: { width: o.width ?? 1280, height: o.height ?? 900 }, deviceScaleFactor: o.scale ?? 1, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 KeelBot/1.0" });
  try {
    return await fn(page);
  } finally {
    await page.close();
    idle = setTimeout(() => { void browser?.then((x) => x.close()); browser = undefined; }, 120_000);
    idle.unref?.();
  }
}
