// Lot planning UI (task 7.2). Plain JS, no framework. Every server string goes
// in through textContent / Text nodes; there is no innerHTML anywhere.
(() => {
  "use strict";

  const root = document.querySelector("#lot-root");
  if (!root) return;

  const TIMEOUT_MS = 15000;
  const MONEY = new Intl.NumberFormat("th-TH");

  const FIELD_LABEL = {
    selected_plots: "ชุดแปลง",
    offer_price: "ราคาที่โรงงานเสนอ",
    moisture_pct: "ความชื้นของแปลง",
    queue_slots: "คิวอัดฟ่อน/ขนส่ง",
  };
  const ORDER_FIELDS = ["plant_id", "target_tons", "offer_price", "max_moisture_pct", "delivery_date"];

  const state = {
    demo: null,
    lot: null,        // latest lot view from the server
    showForm: false,  // true while the order form is shown
    detailsOpen: true,
    resetInfo: null,  // last reset notice from an edit response
    dropped: [],
    failing: [],
  };
  let disabledByBusy = [];

  // ------------------------------------------------------------ helpers

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const kid of kids.flat()) {
      if (kid === undefined || kid === null || kid === false) continue;
      node.append(typeof kid === "string" || typeof kid === "number" ? String(kid) : kid);
    }
    return node;
  }

  function tons(value) {
    // At most 2 decimals, no trailing zeros (same rule as format_tons on the server).
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return String(Number(n.toFixed(2)));
  }
  const baht = (value) => MONEY.format(Number(value));

  function addDays(iso, days) {
    const ms = Date.parse(iso + "T00:00:00Z") + days * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const dateOfDay = (day) => (state.demo ? addDays(state.demo.today, day) : "");

  const slotsOf = (lot, kind) => (lot.slots || []).filter((s) => s.kind === kind);

  function numberOrNull(input) {
    const n = input.valueAsNumber;
    return Number.isFinite(n) ? n : null;
  }

  async function request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const options = { method, signal: controller.signal, credentials: "same-origin" };
      if (body !== undefined) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(body);
      }
      const response = await fetch(path, options);
      let data = {};
      try { data = await response.json(); } catch { data = {}; }
      if (response.status >= 500) return { kind: "fail" };
      return { kind: "http", status: response.status, ok: response.ok, data: data || {} };
    } catch {
      return { kind: "fail" };
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------ shell

  const noticeBox = el("div", { "aria-live": "polite" });
  const main = el("div");
  const overlayHost = el("div");
  root.replaceChildren(noticeBox, main, overlayHost);

  function clearNotice() { noticeBox.replaceChildren(); }

  function showNotice(text, cls, extra = [], lines = []) {
    const box = el("div", { class: "notice " + (cls || ""), role: cls === "error" ? "alert" : "status" }, el("p", { text }));
    if (lines.length) box.append(el("ul", {}, lines.map((l) => el("li", { text: l }))));
    for (const node of extra) box.append(node);
    noticeBox.replaceChildren(box);
    return box;
  }

  function setBusy(busy) {
    if (busy) {
      root.setAttribute("aria-busy", "true");
      disabledByBusy = [...main.querySelectorAll("button")].filter((b) => !b.disabled);
      for (const b of disabledByBusy) b.disabled = true;
    } else {
      root.removeAttribute("aria-busy");
      for (const b of disabledByBusy) b.disabled = false;
      disabledByBusy = [];
    }
  }

  function showResetOverlay(message) {
    const button = el("button", { type: "button", class: "primary-action", text: "รับทราบ" });
    const box = el("div", { role: "alertdialog", "aria-modal": "true", "aria-labelledby": "reset-title" },
      el("h2", { id: "reset-title", text: "เริ่มเดโมใหม่" }),
      el("p", { text: message || "เซสชันเดโมหมดอายุหรือถูกรีเซ็ต ข้อมูลเดิมหายไป ระบบเริ่มใหม่ด้วยข้อมูลตัวอย่าง" }),
      button);
    const overlay = el("div", { class: "modal-overlay" }, box);
    overlayHost.replaceChildren(overlay);
    main.setAttribute("inert", "");
    noticeBox.setAttribute("inert", "");
    const close = () => {
      overlayHost.replaceChildren();
      main.removeAttribute("inert");
      noticeBox.removeAttribute("inert");
    };
    button.addEventListener("click", close);
    overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    button.focus();
  }

  // Run one request. Handles failure (retry), 404 and 409. Returns the response
  // for ok/400/422 so callers can read field errors, or null when handled here.
  async function perform(make) {
    clearNotice();
    setBusy(true);
    const result = await make();
    setBusy(false);
    if (result.kind === "fail") {
      const retry = el("button", { type: "button", text: "ลองใหม่" });
      retry.addEventListener("click", () => { void perform(make).then(afterRetry); });
      showNotice("โหลดผลไม่ได้ ค่าที่กรอกยังอยู่ กดลองใหม่ได้", "error", [retry]);
      return null;
    }
    if (result.status === 404) {
      showResetOverlay();
      await loadAll();
      return null;
    }
    if (result.status === 409) {
      const reload = el("button", { type: "button", text: "โหลดข้อมูลล่าสุด" });
      reload.addEventListener("click", () => { clearNotice(); void reloadLot(); });
      showNotice(result.data.message || "ทำรายการนี้ไม่ได้ในตอนนี้", "error", [reload]);
      return null;
    }
    return result;
  }

  // A retried request that succeeds must update the screen like the first try.
  function afterRetry(result) {
    if (result && result.ok && result.data.lot) acceptLot(result.data);
  }

  function invalidLines(data) {
    const lines = [];
    for (const message of Object.values(data.errors || {})) lines.push(String(message));
    for (const v of data.violations || []) if (v && v.message_th) lines.push(v.message_th);
    return [...new Set(lines)];
  }

  function showInvalid(data) {
    showNotice(data.message || "ข้อมูลไม่ถูกต้อง", "error", [], invalidLines(data));
  }

  // ------------------------------------------------------------ data flow

  function acceptLot(data) {
    state.lot = data.lot;
    state.showForm = false;
    state.resetInfo = data.reset_notice || null;
    state.dropped = data.dropped_plot_ids || [];
    state.failing = data.failing_conditions || [];
    render();
    if (data.reset_notice) showResetNotice(data.reset_notice);
    else if (state.dropped.length) {
      showNotice("เอาแปลงที่ไม่เข้าเงื่อนไขออกแล้ว: " + state.dropped.join(", "), "");
    }
  }

  function showResetNotice(info) {
    const field = FIELD_LABEL[info.changed_field] || info.changed_field;
    const names = info.reset_parties || [];
    showNotice(`แก้ «${field}» จึงต้องยืนยันใหม่${names.length ? " ผู้ที่ต้องยืนยันใหม่:" : ""}`, "reset", [], names);
  }

  async function loadAll() {
    const result = await request("GET", "/api/demo");
    if (result.kind === "fail" || !result.ok) {
      const retry = el("button", { type: "button", text: "ลองใหม่" });
      retry.addEventListener("click", () => { void loadAll(); });
      showNotice("โหลดผลไม่ได้", "error", [retry]);
      return;
    }
    state.demo = result.data;
    if (result.data.session_reset) showResetOverlay();
    const lots = result.data.lots || [];
    if (lots.length) {
      const latest = lots[lots.length - 1];
      const full = await request("GET", "/api/lots/" + encodeURIComponent(latest.lot_id));
      if (full.kind === "http" && full.ok && full.data.lot) {
        clearNotice();
        state.lot = full.data.lot;
        state.showForm = false;
        render();
        return;
      }
      if (full.kind === "fail") {
        const retry = el("button", { type: "button", text: "ลองใหม่" });
        retry.addEventListener("click", () => { void loadAll(); });
        showNotice("โหลดผลไม่ได้", "error", [retry]);
        return;
      }
    }
    clearNotice();
    state.lot = null;
    state.showForm = true;
    render();
  }

  async function reloadLot() {
    if (!state.lot) return loadAll();
    const result = await perform(() => request("GET", "/api/lots/" + encodeURIComponent(state.lot.lot_id)));
    if (result && result.ok && result.data.lot) acceptLot(result.data);
  }

  function write(path, body) {
    // `revision` goes with every write (13.6).
    const full = { ...body, revision: state.lot.revision };
    return () => request("POST", "/api/lots/" + encodeURIComponent(state.lot.lot_id) + path, full);
  }

  async function writeAndApply(path, body) {
    const result = await perform(write(path, body));
    if (!result) return null;
    if (result.ok && result.data.lot) { acceptLot(result.data); return result; }
    showInvalid(result.data);
    return result;
  }

  // ------------------------------------------------------------ order form

  function renderOrderForm() {
    const demo = state.demo;
    const preset = demo.preset || {};
    const plant = el("select", { name: "plant_id", id: "lot-plant", required: true },
      demo.plants.map((p) => el("option", { value: p.plant_id, text: p.name })));
    const target = el("input", { name: "target_tons", id: "lot-target", type: "number", inputmode: "decimal", step: "any", min: "0", value: preset.target_tons ?? 10 });
    const price = el("input", { name: "offer_price", id: "lot-price", type: "number", inputmode: "decimal", step: "any", min: "0", placeholder: "บาท/ตัน" });
    const moisture = el("input", { name: "max_moisture_pct", id: "lot-moisture", type: "number", inputmode: "decimal", step: "any", min: "1", max: "100", value: preset.max_moisture_pct ?? 20 });
    const delivery = el("input", { name: "delivery_date", id: "lot-delivery", type: "date", min: demo.today, value: addDays(demo.today, 8) });
    const inputs = { plant_id: plant, target_tons: target, offer_price: price, max_moisture_pct: moisture, delivery_date: delivery };
    const errs = {};
    const field = (name, label, input) => {
      errs[name] = el("small", { id: "lot-err-" + name });
      input.setAttribute("aria-describedby", "lot-err-" + name);
      return el("label", { for: input.id }, label, input, errs[name]);
    };
    const presetButton = el("button", { type: "button", class: "secondary", text: "ใช้ค่าตั้งต้น 10 ตัน" });
    presetButton.addEventListener("click", () => {
      target.value = String(preset.target_tons ?? 10);
      moisture.value = String(preset.max_moisture_pct ?? 20);
    });
    const submit = el("button", { type: "submit", class: "primary-action", text: "สร้างออเดอร์" });
    const form = el("form", { id: "lot-order-form", "aria-label": "ออเดอร์จากโรงงาน", novalidate: true },
      el("div", { class: "fields" },
        field("plant_id", "โรงงาน", plant),
        field("target_tons", "ปริมาณ (ตัน)", target),
        field("max_moisture_pct", "ความชื้นสูงสุด (%)", moisture),
        field("offer_price", "ราคาที่โรงงานเสนอ (บาท/ตัน)", price),
        field("delivery_date", "วันส่งมอบ", delivery)),
      el("p", { text: "วัสดุ: ฟางข้าว · ราคาโรงงานตัวอย่างเป็นข้อมูลจำลอง" }),
      presetButton,
      submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      for (const name of ORDER_FIELDS) { errs[name].textContent = ""; inputs[name].removeAttribute("aria-invalid"); }
      const body = {
        plant_id: plant.value,
        material: "ฟางข้าว",
        target_tons: numberOrNull(target),
        offer_price: numberOrNull(price),
        max_moisture_pct: numberOrNull(moisture),
        delivery_date: delivery.value,
      };
      const result = await perform(() => request("POST", "/api/orders", body));
      if (!result) return;
      if (result.ok && result.data.lot) { acceptLot(result.data); return; }
      const errors = result.data.errors || {};
      for (const name of ORDER_FIELDS) {
        if (errors[name]) {
          errs[name].textContent = errors[name];
          inputs[name].setAttribute("aria-invalid", "true");
        }
      }
      if (!Object.keys(errors).length) showInvalid(result.data);
      form.querySelector('[aria-invalid="true"]')?.focus();
    });
    const nodes = [el("h2", { text: "ออเดอร์ใหม่จากโรงงาน" }), form];
    if (state.lot) {
      const back = el("button", { type: "button", class: "secondary", text: "กลับไปล็อตเดิม" });
      back.addEventListener("click", () => { state.showForm = false; render(); });
      nodes.push(back);
    }
    main.replaceChildren(...nodes);
  }

  // ------------------------------------------------------------ lot view

  function plotItem(view, excluded) {
    const p = view.plot;
    const moistureText = view.moisture_pct === null || view.moisture_pct === undefined
      ? "ความชื้น: รอตรวจ" : `ความชื้น ${tons(view.moisture_pct)}%`;
    const item = el("li", { class: excluded ? "plot excluded" : "plot", "data-plot-id": p.plot_id },
      el("strong", { text: `${p.owner_name} (${p.plot_id})` }),
      el("div", { text: `${tons(p.expected_tons)} ตัน · ${tons(view.distance_km)} กม. (ข้อมูลจำลอง)` }),
      el("div", { text: `พร้อมเก็บเกี่ยว ${dateOfDay(p.ready_day)} · ต้องเคลียร์แปลงภายใน ${dateOfDay(p.last_clear_day)}` }),
      el("div", { text: moistureText }),
      el("div", { class: excluded ? "reason" : "", text: view.reason_th || "" }));
    return item;
  }

  function editsAllowed(lot) {
    return lot.status !== "closed" && lot.next_action !== "decide_shortfall";
  }

  function selectedItem(view, lot) {
    const item = plotItem(view, false);
    if (!editsAllowed(lot)) return item;
    const p = view.plot;
    if (view.eligibility && view.eligibility.moisture_pending) {
      const input = el("input", { type: "number", step: "any", min: "0", max: "100", inputmode: "decimal", "aria-label": `ความชื้นของแปลง ${p.plot_id} (%)`, placeholder: "ความชื้น %" });
      const save = el("button", { type: "button", class: "secondary", text: "บันทึกความชื้น" });
      save.addEventListener("click", () => { void writeAndApply("/edits", { type: "set_moisture", plot_id: p.plot_id, moisture_pct: numberOrNull(input) }); });
      item.append(el("div", {}, input, save));
    }
    const remove = el("button", { type: "button", class: "secondary", text: "เอาแปลงออก" });
    remove.addEventListener("click", () => { void writeAndApply("/edits", { type: "remove_plot", plot_id: p.plot_id }); });
    item.append(remove);
    return item;
  }

  function slotSelect(lot, kind, current, label) {
    const select = el("select", { "aria-label": label },
      el("option", { value: "", text: "เลือกวัน" }),
      slotsOf(lot, kind).map((s) => el("option", { value: s.slot_id, text: `${s.date} (${s.slot_id}) เหลือ ${tons(s.remaining_tons)} ตัน`, selected: s.slot_id === current })));
    if (current) select.value = current;
    return select;
  }

  function queueSection(lot) {
    const card = el("section", { class: "card", "aria-label": "คิว" }, el("h3", { text: "คิวอัดฟ่อนและขนส่ง (ข้อมูลจำลอง)" }));
    if (lot.bale_slot_id && lot.haul_slot_id) {
      card.append(el("p", { text: `อัดฟ่อน ${lot.bale_date || lot.bale_slot_id} · ขนส่ง ${lot.haul_date || lot.haul_slot_id}` }));
    } else {
      card.append(el("p", { text: "ยังไม่ได้เลือกคิว" }));
    }
    if (lot.first_violation) {
      card.append(el("p", { class: "error", text: lot.first_violation.message_th }));
    }
    if ((lot.violations || []).length) {
      card.append(el("ul", {}, lot.violations.map((v) => el("li", { text: v.message_th }))));
    }
    if (editsAllowed(lot) && (lot.selected || []).length) {
      const bale = slotSelect(lot, "bale", lot.bale_slot_id, "วันอัดฟ่อน");
      const haul = slotSelect(lot, "haul", lot.haul_slot_id, "วันขนส่ง");
      const choose = el("button", { type: "button", class: "secondary", text: "เลือกคิวนี้" });
      choose.addEventListener("click", () => { void writeAndApply("/edits", { type: "set_queue", bale_slot_id: bale.value, haul_slot_id: haul.value }); });
      card.append(el("label", {}, "วันอัดฟ่อน", bale), el("label", {}, "วันขนส่ง", haul), choose);
    }
    return card;
  }

  function moneySection(lot) {
    const offer = el("div", { class: "offer", id: "lot-offer" },
      el("div", { text: "ราคาที่โรงงานเสนอ" }),
      el("strong", { text: `${baht(lot.offer_price)} บาท/ตัน` }));
    if (editsAllowed(lot)) {
      const input = el("input", { type: "number", step: "any", min: "0", inputmode: "decimal", "aria-label": "ราคาที่โรงงานเสนอใหม่ (บาท/ตัน)", placeholder: "ราคาใหม่" });
      const save = el("button", { type: "button", class: "secondary", text: "เปลี่ยนราคา" });
      save.addEventListener("click", () => { void writeAndApply("/edits", { type: "set_price", offer_price: numberOrNull(input) }); });
      offer.append(el("div", {}, input, save));
    }
    const cost = el("div", { class: "cost", id: "lot-cost" }, el("div", { text: "ต้นทุนส่งถึงโรงงาน (ประมาณการ)" }));
    if (lot.delivered_cost) {
      const c = lot.delivered_cost;
      cost.append(
        el("strong", { text: `${baht(c.per_ton)} บาท/ตัน` }),
        el("div", { text: `ค่าฟาง ${baht(c.straw_total)} + ค่าอัดฟ่อน ${baht(c.baling_total)} + ค่าขนส่ง ${baht(c.haul_total)} บาท (ประมาณการ)` }));
    } else {
      cost.append(el("strong", { text: "ยังไม่ได้เลือกปริมาณ" }));
    }
    return [offer, cost];
  }

  function tonsSection(lot) {
    const actual = lot.actual_tons ?? null;
    const dl = el("dl", { class: "tons-grid" },
      el("dt", { text: "ออเดอร์" }), el("dd", { text: `${tons(lot.target_tons)} ตัน` }),
      el("dt", { text: "ประมาณการ" }), el("dd", { class: "estimate", text: `${tons(lot.estimated_tons)} ตัน` }));
    if (actual !== null) dl.append(el("dt", { text: "รับจริง" }), el("dd", { text: `${tons(actual)} ตัน` }));
    const card = el("section", { class: "card tons-card", "aria-label": "ปริมาณ" }, dl);
    if (lot.status === "draft" && Number(lot.shortfall_tons) > 0) {
      card.append(el("p", { class: "error", text: `ขาด ${tons(lot.shortfall_tons)} ตัน` }));
    }
    if (lot.no_eligible_plot) card.append(el("p", { class: "error", text: "ไม่พบแปลงที่เข้าเงื่อนไข" }));
    return card;
  }

  const ROLE_TH = { plant: "โรงงาน", farmer: "เกษตรกร", contractor: "ผู้รับจ้าง" };

  function confirmationSection(lot, contractorInputs) {
    const card = el("section", { class: "card", "aria-label": "บันทึกโดยผู้ประสานงาน" },
      el("h3", { text: "บันทึกโดยผู้ประสานงาน" }),
      el("p", { id: "lot-confirm-count", text: `ยืนยันแล้ว ${lot.confirmed_count}/${lot.confirmation_total}` }));
    const list = el("ol", { class: "parties" });
    for (const c of lot.confirmations || []) {
      const party = { id: c.party_id, role: c.role, name: c.name };
      const name = c.name;
      if (c.confirmed) {
        list.append(el("li", { class: "done" }, el("span", { text: `${name} (${ROLE_TH[c.role] || c.role}) · ยืนยันแล้ว` })));
        continue;
      }
      const row = el("li", { class: "pending" }, el("span", { text: `${name} (${ROLE_TH[party.role] || party.role}) · รอยืนยัน` }));
      if (party.role === "contractor") {
        const bale = el("input", { type: "date", "aria-label": "วันอัดฟ่อน", value: lot.bale_date || "" });
        const haul = el("input", { type: "date", "aria-label": "วันขนส่ง", value: lot.haul_date || "" });
        contractorInputs.bale = bale;
        contractorInputs.haul = haul;
        row.append(el("div", {}, el("label", {}, "วันอัดฟ่อน", bale), el("label", {}, "วันขนส่ง", haul)));
      }
      if (lot.status === "awaiting_confirmation") {
        const button = el("button", { type: "button", class: "secondary", text: "บันทึกว่ายืนยันแล้ว" });
        button.addEventListener("click", () => { void confirmParty(party, contractorInputs); });
        row.append(button);
      }
      list.append(row);
    }
    card.append(list);
    return card;
  }

  function confirmParty(party, contractorInputs) {
    const body = { party_id: party.id };
    if (party.role === "contractor") {
      body.bale_date = contractorInputs.bale ? contractorInputs.bale.value : "";
      body.haul_date = contractorInputs.haul ? contractorInputs.haul.value : "";
    }
    return writeAndApply("/confirmations", body);
  }

  function weightForm(lot) {
    const input = el("input", { id: "lot-weight", name: "actual_tons", type: "number", inputmode: "decimal", step: "any", min: "0", max: "100", "aria-describedby": "lot-weight-error" });
    const error = el("small", { id: "lot-weight-error" });
    const button = el("button", { type: "submit", class: "primary-action", text: "บันทึกน้ำหนักชั่งจริง" });
    const form = el("form", { "aria-label": "น้ำหนักชั่งจริง", novalidate: true },
      el("label", { for: "lot-weight" }, "น้ำหนักชั่งจริง (ตัน)", input, error), button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      input.removeAttribute("aria-invalid");
      const value = numberOrNull(input);
      const result = await perform(write("/weight", { actual_tons: value }));
      if (!result) return;
      if (result.ok && result.data.lot) {
        acceptLot(result.data);
        return;
      }
      const message = (result.data.errors && result.data.errors.actual_tons) || result.data.message || "น้ำหนักต้องมากกว่า 0 และไม่เกิน 100 ตัน";
      error.textContent = message;
      input.setAttribute("aria-invalid", "true");
      input.focus();
    });
    return form;
  }

  function shortfallBox(lot) {
    const decision = lot.shortfall_decision || null;
    const shortfall = decision ? decision.shortfall_tons : null;
    const box = el("section", { class: "card", "aria-label": "ปริมาณขาด" });
    box.append(el("p", { class: "error", id: "lot-shortfall", text: shortfall === null ? "ขาดจากเป้าหมาย" : `ขาด ${tons(shortfall)} ตัน` }));
    const accept = el("button", { type: "button", class: "secondary", "data-choice": "plant_accepts", text: "โรงงานรับตามจริง" });
    const more = el("button", { type: "button", class: "secondary", "data-choice": "source_more", text: "ต้องหาเพิ่ม" });
    for (const [button, choice] of [[accept, "plant_accepts"], [more, "source_more"]]) {
      button.addEventListener("click", () => { void writeAndApply("/shortfall-decision", { choice }); });
    }
    box.append(el("div", { role: "group", "aria-label": "ตัวเลือก" }, accept, more));
    return box;
  }

  function closedSummary(lot) {
    const actual = lot.actual_tons ?? null;
    const card = el("section", { class: "card", "aria-label": "สรุป" });
    const base = `ออเดอร์ ${tons(lot.target_tons)} ตัน · ประมาณการ ${tons(lot.estimated_tons)} ตัน`;
    card.append(el("p", { id: "lot-summary", text: actual === null ? base : `${base} · รับจริง ${tons(actual)} ตัน` }));
    const decision = lot.shortfall_decision || null;
    const choice = decision ? decision.resolution : null;
    if (choice === "plant_accepts") card.append(el("p", { text: "โรงงานรับตามจริง" }));
    if (choice === "source_more") {
      const left = decision.remaining_to_source_tons;
      card.append(el("p", { text: left === null || left === undefined ? "ต้องหาเพิ่ม" : `ต้องหาเพิ่ม ${tons(left)} ตัน` }));
    }
    return card;
  }

  function primaryAction(lot, contractorInputs) {
    switch (lot.next_action) {
      case "propose": {
        const b = el("button", { type: "button", class: "primary-action", text: "เสนอชุดแปลง" });
        b.addEventListener("click", () => { void writeAndApply("/proposal", {}); });
        return [b];
      }
      case "submit": {
        const b = el("button", { type: "button", class: "primary-action", text: "ไปขั้นรอยืนยัน" });
        b.addEventListener("click", () => { void writeAndApply("/submit", {}); });
        return [b];
      }
      case "wait_for_confirmations": {
        const next = (lot.confirmations || []).find((c) => !c.confirmed);
        if (!next) return [];
        const first = next.name;
        const party = { id: next.party_id, role: next.role, name: next.name };
        const b = el("button", { type: "button", class: "primary-action", text: `บันทึกว่ายืนยันแล้ว: ${first}` });
        b.addEventListener("click", () => { void confirmParty(party, contractorInputs); });
        return [b];
      }
      case "record_weight":
        return [weightForm(lot)];
      case "decide_shortfall":
        return [shortfallBox(lot)];
      case "new_order": {
        const view = el("button", { type: "button", class: "secondary", text: "ดูผล" });
        view.addEventListener("click", () => {
          state.detailsOpen = true;
          render();
          main.querySelector("details")?.scrollIntoView?.();
        });
        const fresh = el("button", { type: "button", class: "primary-action", text: "เริ่มออเดอร์ใหม่" });
        fresh.addEventListener("click", () => { state.showForm = true; render(); });
        return [view, fresh];
      }
      default:
        return [];
    }
  }

  function renderLot() {
    const lot = state.lot;
    const contractorInputs = {};
    const head = el("div", { class: "lot-head" },
      el("h2", { text: `ล็อต ${lot.lot_id}` }),
      el("span", { class: "status-badge", "data-status": lot.status, text: lot.status_label }));
    const parts = [head, tonsSection(lot), ...primaryAction(lot, contractorInputs)];

    if (state.failing.length) {
      parts.push(el("div", { class: "notice error" }, el("p", { text: "แผนยังไม่ครบเงื่อนไข" }), el("ul", {}, state.failing.map((t) => el("li", { text: t })))));
    }

    if (lot.status === "closed") parts.push(closedSummary(lot));

    const details = el("details", {}, el("summary", { text: "รายละเอียดล็อต" }));
    if (state.detailsOpen) details.setAttribute("open", "");
    details.addEventListener("toggle", () => { state.detailsOpen = details.open; });

    details.append(el("section", { class: "card", "aria-label": "เงื่อนไขออเดอร์" },
      el("h3", { text: "เงื่อนไขออเดอร์" }),
      el("ol", {}, (lot.conditions_th || []).map((t) => el("li", { text: t })))));
    details.append(...moneySection(lot));
    if (lot.status === "awaiting_confirmation" || (lot.status === "ready" && lot.confirmation_total)) {
      details.append(confirmationSection(lot, contractorInputs));
    }

    const selected = el("section", { class: "card", "aria-label": "แปลงที่เลือก" }, el("h3", { text: "แปลงที่เลือก" }));
    if ((lot.selected || []).length) selected.append(el("ol", {}, lot.selected.map((v) => selectedItem(v, lot))));
    else selected.append(el("p", { text: "ยังไม่ได้เลือกแปลง" }));
    if (editsAllowed(lot) && (lot.addable_plots || []).length) {
      const adds = el("ul", { role: "group", "aria-label": "เพิ่มแปลง", class: "addable" });
      for (const p of lot.addable_plots) {
        const moisture = p.moisture_pct === null || p.moisture_pct === undefined ? "ความชื้น: รอตรวจ" : `ความชื้น ${tons(p.moisture_pct)}%`;
        const b = el("button", { type: "button", class: "secondary", text: `เพิ่มแปลง ${p.plot_id}` });
        b.addEventListener("click", () => { void writeAndApply("/edits", { type: "add_plot", plot_id: p.plot_id }); });
        adds.append(el("li", { "data-plot-id": p.plot_id },
          el("strong", { text: `${p.owner_name} (${p.plot_id})` }),
          el("div", { text: `คาดว่า ${tons(p.expected_tons)} ตัน · ${tons(p.distance_km)} กม. (ข้อมูลจำลอง)` }),
          el("div", { text: `พร้อมเก็บเกี่ยว ${p.ready_date} · ต้องเคลียร์แปลงภายใน ${p.last_clear_date}` }),
          el("div", { text: moisture }),
          b));
      }
      selected.append(adds);
    }
    details.append(selected);

    const excluded = el("section", { class: "card", "aria-label": "แปลงที่ไม่เข้าเงื่อนไข" }, el("h3", { text: "แปลงที่ไม่เข้าเงื่อนไข" }));
    if ((lot.excluded || []).length) excluded.append(el("ol", {}, lot.excluded.map((v) => plotItem(v, true))));
    else excluded.append(el("p", { text: "ไม่มี" }));
    details.append(excluded);

    details.append(queueSection(lot));
    parts.push(details);
    main.replaceChildren(...parts);
  }

  function render() {
    if (!state.demo) return;
    if (state.showForm || !state.lot) renderOrderForm();
    else renderLot();
  }

  void loadAll();
})();
