const { chromium } = require("playwright-core");
const prefix = process.argv[2];
const dir = "/home/iphone/Desktop/Hackathon/agricarbon-match-ai/docs/screenshots/";
const URL = "http://127.0.0.1:8765/";
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const out = {};
  async function measure(page, tag) {
    const m = await page.evaluate(() => {
      const bad = [];
      for (const e of document.querySelectorAll("button,input,select,summary,[role=tab]")) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 44 - 0.5 || r.height < 44 - 0.5) bad.push(`${e.tagName}.${e.className}:${(e.textContent||e.name||"").slice(0,15)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
      }
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad };
    });
    out[tag] = m;
  }
  for (const w of [360, 430]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 640 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.click("#tab-lot");
    await page.waitForSelector("#lot-order-form");
    await page.waitForTimeout(300);
    const btn = await page.locator("#lot-order-form button[type=submit]").boundingBox();
    out["form" + w] = { submitBottom: btn.y + btn.height, submitTop: btn.y, scrollY: await page.evaluate(() => scrollY) };
    await measure(page, "form" + w + "_touch");
    if (w === 360) await page.screenshot({ path: dir + prefix + "-order-form-360x640.png" });
    await page.fill("#lot-price", "1100"); await page.click("#lot-order-form button[type=submit]");
    await page.waitForSelector("button.primary-action");
    await page.waitForTimeout(300);
    // propose
    await page.click("button.primary-action:has-text('เสนอชุดแปลง')");
    await page.waitForSelector("button.primary-action:has-text('ไปขั้นรอยืนยัน')");
    await page.waitForTimeout(300);
    await measure(page, "proposal" + w);
    if (w === 360) {
      await page.screenshot({ path: dir + prefix + "-proposal-360x640.png" });
      await page.screenshot({ path: dir + prefix + "-proposal-full-360.png", fullPage: true });
    }
    await page.click("button.primary-action:has-text('ไปขั้นรอยืนยัน')");
    await page.waitForSelector("button.primary-action:has-text('บันทึกว่ายืนยันแล้ว')");
    for (let i = 0; i < 8; i++) {
      const b = page.locator("button.primary-action:has-text('บันทึกว่ายืนยันแล้ว')");
      if (!(await b.count())) break;
      await b.first().click();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(300);
    await measure(page, "ready" + w);
    if (w === 360) {
      await page.screenshot({ path: dir + prefix + "-ready-360x640.png" });
      await page.screenshot({ path: dir + prefix + "-ready-full-360.png", fullPage: true });
    }
    // weight
    const wi = page.locator("#lot-weight");
    if (await wi.count()) {
      await wi.fill("9.5");
      await page.click("button:has-text('บันทึกน้ำหนักชั่งจริง')");
      await page.waitForTimeout(400);
      if (await page.locator("[data-choice=plant_accepts]").count()) {
        if (w === 360) await page.screenshot({ path: dir + prefix + "-shortfall-360x640.png" });
        await page.click("[data-choice=plant_accepts]");
        await page.waitForTimeout(400);
      }
    }
    await measure(page, "closed" + w);
    if (w === 360) {
      await page.screenshot({ path: dir + prefix + "-closed-360x640.png" });
      await page.screenshot({ path: dir + prefix + "-closed-full-360.png", fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
