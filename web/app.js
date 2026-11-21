const form = document.querySelector("#search");
const status = document.querySelector("#status");
const retry = document.querySelector("#retry");
const results = document.querySelector("#results");
const submit = document.querySelector("#submit");
const fields = ["material", "quantity_tons", "province"];
const number = new Intl.NumberFormat("th-TH");
const SEARCH_TIMEOUT_MS = 10000;
const LOAD_TIMEOUT_MS = 10000;
const LIFF_TIMEOUT_MS = 15000;
const LOAD_FAILED = "โหลดผลไม่ได้";
const NO_RESULT = "ไม่พบโรงงานที่ตรงเงื่อนไข";
const LIFF_FAILED = "เชื่อมต่อ LINE ไม่สำเร็จ คุณยังใช้งานผ่านเว็บได้";
const BAD_REQUEST = "ส่งข้อมูลไม่ถูกต้อง กรุณาตรวจข้อมูลแล้วค้นหาใหม่";
let configured = false;

// fetch with AbortController timeout. Aborted/network errors reject.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function loadScript(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    script.src = src;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); reject(new Error("load")); };
    document.head.append(script);
  });
}

async function initLiff(liffId) {
  try {
    await loadScript("https://static.line-scdn.net/liff/edge/2/sdk.js", LIFF_TIMEOUT_MS);
    await Promise.race([
      window.liff.init({ liffId }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), LIFF_TIMEOUT_MS)),
    ]);
  } catch {
    document.querySelector("#liff-status").textContent = LIFF_FAILED;
  }
}

function showFailure() {
  results.replaceChildren();
  status.textContent = LOAD_FAILED;
  retry.hidden = false;
}

async function configure() {
  retry.hidden = true;
  status.textContent = "";
  try {
    const response = await fetchWithTimeout("/api/config", {}, LOAD_TIMEOUT_MS);
    if (!response.ok) throw new Error();
    const config = await response.json();
    if (!configured) {
      for (const [field, values] of [["material", config.materials], ["province", config.provinces]]) {
        for (const value of values) form.elements[field].add(new Option(value, value));
      }
    }
    configured = true;
    submit.disabled = false;
    if (config.liff_id) void initLiff(config.liff_id);
  } catch {
    showFailure();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  retry.hidden = true;
  results.replaceChildren();
  status.textContent = "กำลังค้นหา…";
  for (const field of fields) {
    form.elements[field].removeAttribute("aria-invalid");
    document.getElementById(field + "-error").textContent = "";
  }
  try {
    const response = await fetchWithTimeout("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        material: form.elements.material.value,
        quantity_tons: form.elements.quantity_tons.valueAsNumber,
        province: form.elements.province.value,
      }),
    }, SEARCH_TIMEOUT_MS);
    if (response.status >= 500) throw new Error();
    if (response.status === 400) {
      let message = BAD_REQUEST;
      try {
        const body = await response.json();
        if (typeof body.message === "string" && body.message) message = body.message;
      } catch { /* keep fallback */ }
      status.textContent = message;
      return;
    }
    const data = await response.json();
    if (response.status === 422) {
      status.textContent = "ตรวจสอบข้อมูลในช่องที่ระบุ";
      const errors = data.errors || {};
      for (const field of fields.filter((key) => errors[key])) {
        form.elements[field].setAttribute("aria-invalid", "true");
        document.getElementById(field + "-error").textContent = errors[field];
      }
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    if (!response.ok || !Array.isArray(data.matches)) throw new Error();
    status.textContent = data.matches.length ? `พบ ${data.matches.length} โรงงาน` : NO_RESULT;
    for (const match of data.matches) {
      const item = document.createElement("li");
      const name = document.createElement("strong");
      name.textContent = match.name;
      item.append(name, `${number.format(match.distance_km)} กม. · ราคาจำลอง ${number.format(match.simulated_price_thb_per_ton)} บาท/ตัน`);
      results.append(item);
    }
  } catch {
    showFailure();
  } finally {
    submit.disabled = !configured;
  }
});

retry.addEventListener("click", () => (configured ? form.requestSubmit() : void configure()));

// Tabs: show one panel at a time; no innerHTML.
const tabs = document.querySelectorAll('[role="tab"]');
function selectTab(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
    if (active && tab.dataset.context) document.getElementById("bar-context").textContent = tab.dataset.context;
  }
}
for (const tab of tabs) tab.addEventListener("click", () => selectTab(tab));

void configure();
