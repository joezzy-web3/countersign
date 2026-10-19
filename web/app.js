// Countersign board. Reads Arkiv directly from the browser: no backend in the read path.
import { CONFIG } from "./core/config.js";
import { Q, loadSnapshot, queryAll } from "./core/rpc.js";
import { STATUS, boardDigest, judgeBoard } from "./core/verdict.js";
import { checkTarget } from "./core/check.js";
import { trustPath } from "./core/path.js";

const $ = (id) => document.getElementById(id);
const BLOCK_SECONDS = 2;
const ALERT_LIFETIME_BLOCKS = (7 * 24 * 3600) / BLOCK_SECONDS;
const LABELS = {
  verified: "Sealed",
  impostor: "Impostor",
  revoked: "Revoked",
  unverified: "No seal",
};

const state = {
  mode: "replay",
  filter: "all",
  snapshot: null,
  board: null,
  previous: new Map(), // key -> { status, cosigns }
  serverVerifiedKeys: null, // Set from the server-side $creator query, live mode only
  replayTimer: null,
  unwatch: null,
  refreshTimer: null,
  pollTimer: null,
  lastRefresh: 0,
  busy: false,
  seal: null, // 3D hero, if WebGL is available
  toneTimer: null,
  lastCheck: "",
  rendered: new Set(),
};

/* ---------- 3D hero seal ---------- */

const CAPTIONS = {
  sealed: "Sealed: signer traced to the root",
  impostor: "Impostor: name copied, $creator doesn't match",
  revoked: "Revoked: the root cancelled this seal",
};

function setSealTone(tone, holdMs = 0) {
  clearTimeout(state.toneTimer);
  state.seal?.setTone(tone);
  const cap = document.querySelector(".seal-caption");
  cap.className = `seal-caption mono ${tone}`;
  $("sealCaption").textContent = CAPTIONS[tone];
  if (holdMs) state.toneTimer = setTimeout(() => setSealTone("sealed"), holdMs);
}

async function mountHero() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    const { mountSeal } = await import("./vendor/seal3d.js");
    state.seal = mountSeal($("seal3d"), { reducedMotion: reduced });
  } catch (err) {
    console.warn("3D seal unavailable", err);
  }
  if (!state.seal) {
    $("seal3d").hidden = true;
    $("sealFallback").hidden = false;
  }
}

function setEvents(text) {
  $("eventsMode").textContent = text;
  $("eventsHero").textContent = text.replace(/^Events: /, "events: ").split(" (")[0].split(".")[0];
}

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "–");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function notice(text, kind = "") {
  const el = $("notice");
  if (!text) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = `notice ${kind}`;
  el.textContent = text;
}

function tick(text, status = "") {
  const li = document.createElement("li");
  li.className = status;
  li.innerHTML = text;
  const list = $("ticker");
  list.prepend(li);
  while (list.children.length > 40) list.lastChild.remove();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ---------- rendering ---------- */

function labelFor(address, board) {
  if (!address) return "?";
  if (address === board.trust.root) return "root";
  return board.trust.signers.get(address)?.label || short(address);
}

function render() {
  const board = state.board;
  if (!board) return;

  for (const [id, n] of [["nVerified", board.counts.verified], ["nImpostor", board.counts.impostor], ["nRevoked", board.counts.revoked], ["nUnverified", board.counts.unverified]]) {
    const el = $(id);
    if (el.textContent !== String(n)) {
      el.textContent = n;
      const stat = el.parentElement;
      stat.classList.remove("bump");
      void stat.offsetWidth;
      stat.classList.add("bump");
    }
  }
  const live = state.mode === "live";
  $("blockPill").textContent = `block ${board.head.toLocaleString("en-US")}`;
  $("blockPill").classList.toggle("live", live);
  $("heroMode").textContent = live ? "Live chain" : "Replay of real Tiramisu data";
  $("digestBadge").textContent = live ? "Live" : "Replay";
  $("digestBadge").classList.toggle("live", live);
  $("dBlock").textContent = board.head.toLocaleString("en-US");
  $("dImp").textContent = board.counts.impostor;
  $("dVer").textContent = board.counts.verified;
  $("dRev").textContent = board.counts.revoked;
  $("cAll").textContent = board.alerts.length;
  $("cVer").textContent = board.counts.verified;
  $("cFlag").textContent = board.counts.impostor + board.counts.revoked;
  renderSuggestions();
  requestAnimationFrame(placeThumbs);
  $("rootAddr").textContent = board.trust.root;

  // Seals
  const seals = $("seals");
  seals.innerHTML = "";
  for (const [addr, s] of board.trust.signers) {
    const li = document.createElement("li");
    li.className = s.state;
    const days = s.state === "active" ? ` · ${Math.max(0, Math.round(((s.expiresAt - board.head) * BLOCK_SECONDS) / 86400))}d left` : "";
    li.innerHTML = `<span><span class="lbl">${escapeHtml(s.label || "unlabelled")}</span><br><span class="mono muted">${short(addr)}</span></span><span class="st">${s.state}${days}</span>`;
    seals.append(li);
  }

  // Feed
  const feed = $("feed");
  feed.innerHTML = "";
  const tpl = $("cardTpl");
  const rows = board.alerts.filter((a) => {
    if (state.filter === "verified") {
      return state.serverVerifiedKeys ? state.serverVerifiedKeys.has(a.key) : a.verdict.status === STATUS.VERIFIED;
    }
    if (state.filter === "flagged") return a.verdict.status === STATUS.IMPOSTOR || a.verdict.status === STATUS.REVOKED;
    return true;
  });
  $("empty").hidden = rows.length > 0;

  for (const a of rows) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const st = a.verdict.status;
    node.classList.add(st);
    if (!state.rendered.has(a.key + st)) node.classList.add("enter"); // animate only what is new or changed
    state.rendered.add(a.key + st);
    node.dataset.key = a.key;
    node.querySelector(".stamp span").textContent = LABELS[st];
    node.querySelector(".kind").textContent = a.attrs.kind ?? "alert";
    const sev = Number(a.attrs.severity ?? 0);
    node.querySelector(".sev").textContent = "●".repeat(sev) + "○".repeat(Math.max(0, 5 - sev));
    node.querySelector(".sev").title = `severity ${sev} of 5`;
    node.querySelector(".target").textContent = a.attrs.target ?? "";
    node.querySelector(".title").textContent = a.payload?.title ?? "(no title)";
    node.querySelector(".summary").textContent = a.payload?.summary ?? "";
    node.querySelector(".claims").textContent = a.attrs.claims || "(nobody)";
    const creator = node.querySelector(".creator");
    const who = labelFor(a.creator, board);
    creator.textContent = who === short(a.creator) ? short(a.creator) : `${who} · ${short(a.creator)}`;
    creator.href = `${CONFIG.explorer}/address/${a.creator}`;
    node.querySelector(".reason").textContent = a.verdict.reason;
    const path = node.querySelector(".path");
    for (const step of trustPath(a, board)) {
      const li = document.createElement("li");
      li.className = step.ok ? "ok" : "bad";
      li.innerHTML = `<b>${escapeHtml(step.label)}</b><small>${escapeHtml(step.sub)}</small>`;
      path.append(li);
    }

    const cos = node.querySelector(".cosigns");
    for (const c of a.cosigners) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `✓ ${c.label}`;
      cos.append(chip);
    }
    if (st === STATUS.VERIFIED) {
      const q = document.createElement("span");
      q.className = `chip quorum ${a.confirmed ? "ok" : ""}`;
      q.title = "Author's seal plus independent countersigns. One leaked key can never reach 2 alone.";
      q.textContent = a.confirmed ? `Confirmed · ${a.seals} seals` : `${a.seals} of 2 seals`;
      cos.prepend(q);
    }
    if (a.ignoredCosigns) {
      const chip = document.createElement("span");
      chip.className = "chip off";
      chip.textContent = `${plural(a.ignoredCosigns, "unsealed cosign")} ignored`;
      cos.append(chip);
    }

    const left = Math.max(0, a.expiresAt - board.head);
    const pct = Math.min(100, (left / ALERT_LIFETIME_BLOCKS) * 100);
    node.querySelector(".bar i").style.width = `${pct}%`;
    const days = (left * BLOCK_SECONDS) / 86400;
    node.querySelector(".leaseText").textContent = Number.isFinite(days)
      ? `lease ${days >= 1 ? days.toFixed(1) + " days" : Math.round(days * 24) + " h"} left`
      : "no expiry";
    node.querySelector(".lease").title = `Expires at block ${a.expiresAt}. Each countersign renews it for 7 days.`;

    const cosignBtn = node.querySelector(".cosignBtn");
    cosignBtn.hidden = !(state.mode === "live" && st === STATUS.VERIFIED);
    cosignBtn.addEventListener("click", () => countersign(a.key, cosignBtn));

    const raw = node.querySelector(".raw");
    node.querySelector(".inspectBtn").addEventListener("click", () => {
      raw.hidden = !raw.hidden;
      if (!raw.hidden) {
        raw.textContent = JSON.stringify(
          {
            explorer: `${CONFIG.explorer}/entity/${a.key}`,
            key: a.key,
            $creator: a.creator,
            $owner: a.owner,
            createdAt: a.createdAt,
            expiresAt: a.expiresAt,
            creationFlags: a.flags,
            attributes: a.attrs,
            payload: a.payload,
            verdict: a.verdict,
          },
          (_k, v) => (v === Infinity ? "never" : v),
          2,
        );
      }
    });
    feed.append(node);
  }

  $("attackBtn").disabled = state.busy;
  $("attackBtn").title = state.mode === "live" ? "" : "Switches to the live chain first";
}

/* ---------- board updates ---------- */

async function setSnapshot(snapshot, { announce = true } = {}) {
  state.snapshot = snapshot;
  const board = judgeBoard(snapshot, CONFIG.root);
  if (announce) diffAndAnnounce(board);
  state.board = board;
  render();
  const digest = await boardDigest(board);
  $("digest").textContent = digest.slice(0, 32) + "…";
  $("digestHero").textContent = digest.slice(0, 12);
  if (state.lastCheck) runCheck(state.lastCheck, { quiet: true });
  if (snapshot.queries) {
    $("queries").textContent = Object.entries(snapshot.queries)
      .map(([k, q]) => `# ${k}\n${q}`)
      .join("\n\n");
  }
}

function diffAndAnnounce(board) {
  const prev = state.previous;
  const next = new Map();
  for (const a of board.alerts) {
    const before = prev.get(a.key);
    const who = escapeHtml(labelFor(a.creator, board));
    const st = a.verdict.status;
    if (!before) {
      if (prev.size || state.mode === "replay") {
        tick(`<b>${who}</b> posted “${escapeHtml(a.payload?.title ?? a.attrs.target)}” → <b>${LABELS[st]}</b>`, st);
        if (st === STATUS.IMPOSTOR) setSealTone("impostor", 4200);
        else if (st === STATUS.VERIFIED) state.seal?.stamp();
      }
      setTimeout(() => {
        const el = document.querySelector(`.card[data-key="${a.key}"]`);
        el?.classList.add("flash");
        setTimeout(() => el?.classList.remove("flash"), 2400);
      }, 0);
    } else {
      if (before.status !== st) tick(`“${escapeHtml(a.payload?.title ?? "")}” is now <b>${LABELS[st]}</b>`, st);
      if (a.cosigners.length > before.cosigns) {
        const c = a.cosigners[a.cosigners.length - 1];
        tick(`<b>${escapeHtml(c.label)}</b> countersigned “${escapeHtml(a.payload?.title ?? "")}”; lease renewed 7 days`, "verified");
      }
    }
    next.set(a.key, { status: st, cosigns: a.cosigners.length });
  }
  if (state.board) {
    for (const [addr, s] of board.trust.signers) {
      const old = state.board.trust.signers.get(addr);
      if (s.state === "revoked" && old?.state !== "revoked") {
        tick(`Root revoked <b>${escapeHtml(s.label)}</b>. Every seal it made now reads REVOKED.`, "revoked");
        setSealTone("revoked", 4200);
      }
      if (!old && s.state === "active") tick(`Root granted a seal to <b>${escapeHtml(s.label)}</b>`, "verified");
    }
  }
  state.previous = next;
}

/* ---------- replay ---------- */

async function startReplay() {
  stopLive();
  state.mode = "replay";
  setModeButtons();
  notice("");
  let rec;
  try {
    rec = await (await fetch("replay.json", { cache: "no-store" })).json();
  } catch {
    notice("No recording found. Switching to live.", "err");
    return startLive();
  }
  const fix = (list) => list.map((e) => ({ ...e, expiresAt: e.expiresAt === "Infinity" ? Infinity : e.expiresAt }));
  const full = {
    grants: fix(rec.snapshot.grants),
    revokes: fix(rec.snapshot.revokes),
    alerts: fix(rec.snapshot.alerts),
    cosigns: fix(rec.snapshot.cosigns),
  };
  const all = [...full.grants, ...full.revokes, ...full.alerts, ...full.cosigns];
  const blocks = [...new Set(all.map((e) => e.createdAt))].sort((a, b) => a - b);
  state.previous = new Map();
  state.board = null;
  $("ticker").innerHTML = "";
  tick(`Replaying Tiramisu recording up to block ${Number(rec.head).toLocaleString("en-US")} (${new Date(rec.recordedAt).toUTCString()})`);

  let i = 0;
  const step = async () => {
    if (state.mode !== "replay") return;
    if (i >= blocks.length) {
      tick("Recording finished. Switching to the live chain…");
      state.replayTimer = setTimeout(() => state.mode === "replay" && startLive(), 2200);
      return;
    }
    const b = blocks[i++];
    const upTo = (list) => list.filter((e) => e.createdAt <= b);
    await setSnapshot({
      head: Math.max(b, i === blocks.length ? Number(rec.head) : b),
      grants: upTo(full.grants),
      revokes: upTo(full.revokes),
      alerts: upTo(full.alerts),
      cosigns: upTo(full.cosigns),
      queries: null,
    });
    state.replayTimer = setTimeout(step, 1300);
  };
  step();
}

/* ---------- live ---------- */

let rpcUrl = CONFIG.rpcHttp;

async function refreshLive() {
  state.lastRefresh = Date.now();
  try {
    let snap;
    try {
      snap = await loadSnapshot(rpcUrl, CONFIG.root);
    } catch (err) {
      // A TypeError from fetch means the browser could not reach the node at all (network/CORS).
      if (!(err instanceof TypeError) || rpcUrl !== CONFIG.rpcHttp || location.protocol === "file:") throw err;
      rpcUrl = new URL("/rpc", location.href).href;
      tick("Direct RPC unreachable from this browser; reading through the site's pass-through proxy.");
      snap = await loadSnapshot(rpcUrl, CONFIG.root);
    }
    if (state.mode !== "live") return;
    await setSnapshot(snap);
    await refreshServerVerified();
  } catch (err) {
    if (err.code === 429) {
      // Budget exhausted: stop spending, keep the last board on screen.
      stopLive();
      notice(err.message, "err");
      setEvents("Events: paused (query budget used up)");
      return;
    }
    notice(`Could not read Arkiv: ${err.message}`, "err");
  }
}

/** "Verified only" is answered by the node: alerts whose $creator is an active seal. */
async function refreshServerVerified() {
  if (state.filter !== "verified" || !state.board) {
    state.serverVerifiedKeys = null;
    return;
  }
  const creators = [state.board.trust.root, ...[...state.board.trust.signers].filter(([, s]) => s.state === "active").map(([a]) => a)];
  const q = Q.alertsBy(creators);
  const r = await queryAll(rpcUrl, q, { atBlock: state.board.head });
  state.serverVerifiedKeys = new Set(r.entities.map((e) => e.key));
  $("queries").textContent = `# verified only (server-side $creator filter)\n${q}\n\n` + $("queries").textContent.replace(/^# verified only[\s\S]*?\n\n/, "");
  render();
}

function knownWallets() {
  const set = new Set(Object.values(CONFIG.wallets).map((a) => a.toLowerCase()));
  set.add(CONFIG.root.toLowerCase());
  if (state.board) {
    for (const a of state.board.trust.signers.keys()) set.add(a);
    for (const a of state.board.alerts) set.add(a.creator);
  }
  return set;
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  const wait = Math.max(800, 2500 - (Date.now() - state.lastRefresh));
  state.refreshTimer = setTimeout(refreshLive, wait);
}

async function watchEvents() {
  // WebSocket push via the Arkiv SDK. If anything here fails, fall back to polling.
  try {
    const [{ createPublicClient }, { tiramisu }, { webSocket }] = await Promise.all([
      import("https://esm.sh/@arkiv-network/sdk@0.8.1"),
      import("https://esm.sh/@arkiv-network/sdk@0.8.1/chains"),
      import("https://esm.sh/viem@2"),
    ]);
    const client = createPublicClient({ chain: tiramisu, transport: webSocket(CONFIG.rpcWs) });
    let errors = 0;
    state.unwatch = client.watchEntityEvents({
      onEvent: (ev) => {
        // Every app on Arkiv shares this event stream, and each re-read costs query budget, so only
        // react to our own entities or to a wallet the board already knows.
        const known = state.previous.has(String(ev.entityKey).toLowerCase());
        const fromKnown = ev.type === "EntityCreated" && knownWallets().has(String(ev.owner).toLowerCase());
        if (known || fromKnown) scheduleRefresh();
      },
      onError: (e) => {
        errors += 1;
        console.warn("watchEntityEvents", e);
        if (errors === 3) startPolling("WebSocket errors");
      },
    });
    setEvents("Events: WebSocket push (watchEntityEvents), filtered to known wallets. Expiry has no event, so the board also re-reads every 2 min.");
    state.pollTimer = setInterval(refreshLive, 120_000);
  } catch (err) {
    console.warn("SDK/WebSocket unavailable", err);
    startPolling("SDK could not load");
  }
}

function startPolling(why) {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refreshLive, 20_000);
  setEvents(`Events: polling every 20 s (${why}).`);
}

async function startLive() {
  clearTimeout(state.replayTimer);
  state.mode = "live";
  setModeButtons();
  notice("");
  tick("Live: reading Tiramisu directly from your browser.");
  await refreshLive();
  if (!state.unwatch) watchEvents();
}

function stopLive() {
  state.unwatch?.();
  state.unwatch = null;
  clearInterval(state.pollTimer);
  clearTimeout(state.refreshTimer);
  clearTimeout(state.replayTimer);
  setEvents("Events: idle (replay)");
}

function setModeButtons() {
  $("modeReplay").classList.toggle("on", state.mode === "replay");
  $("modeLive").classList.toggle("on", state.mode === "live");
  render();
  placeThumbs();
}

/* ---------- demo actions (the only things that touch our server) ---------- */

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function attack() {
  if (state.mode !== "live") await startLive();
  state.busy = true;
  render();
  const ab = $("attackBtn");
  ab.classList.add("busy", "fired");
  setTimeout(() => ab.classList.remove("fired"), 700);
  notice("The impostor is signing an alert in a trusted name…");
  try {
    const r = await post("/api/attack");
    notice(`Impostor alert landed (tx ${short(r.txHash)}), claiming “${r.claims}”. Watch it get stamped.`, "ok");
    tick(`Impostor ${short(r.impostor)} signed an alert claiming <b>${escapeHtml(r.claims)}</b>`, "impostor");
    scheduleRefresh();
  } catch (err) {
    notice(`Attack not sent: ${err.message}`, "err");
  } finally {
    state.busy = false;
    $("attackBtn").classList.remove("busy");
    render();
  }
}

async function countersign(alertKey, btn) {
  btn.disabled = true;
  btn.classList.add("busy");
  btn.querySelector("span").textContent = "Signing…";
  try {
    const r = await post("/api/cosign", { alertKey });
    notice(`Countersigned by ${short(r.signer)} in one atomic batch (cosign + 7-day renewal), tx ${short(r.txHash)}.`, "ok");
    scheduleRefresh();
  } catch (err) {
    notice(`Countersign refused: ${err.message}`, "err");
    btn.disabled = false;
    btn.classList.remove("busy");
    btn.querySelector("span").textContent = "Countersign";
  }
}

/* ---------- segmented controls + nav indicator ---------- */

function placeThumb(group, active) {
  const thumb = group?.querySelector(".thumb");
  if (!thumb || !active) return;
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
}

function placeThumbs() {
  placeThumb($("tabs"), document.querySelector(".tab.on"));
  placeThumb($("modeSeg"), document.querySelector("#modeSeg button.on"));
}
window.addEventListener("resize", placeThumbs);
document.fonts?.ready.then(placeThumbs);

// Scroll-spy: the gold ink line slides under the section you are reading.
const spyLinks = [...document.querySelectorAll("#navLinks a[data-spy]")];
const ink = document.querySelector("#navLinks .ink");
function moveInk(link) {
  spyLinks.forEach((a) => a.classList.toggle("on", a === link));
  if (!link) return (ink.style.opacity = "0");
  ink.style.opacity = "1";
  ink.style.width = `${link.offsetWidth}px`;
  ink.style.transform = `translateX(${link.offsetLeft}px)`;
}
const spy = new IntersectionObserver(
  (entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) moveInk(spyLinks.find((a) => a.dataset.spy === visible.target.id));
  },
  { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5] },
);
["check", "board", "how"].forEach((id) => spy.observe($(id)));
window.addEventListener("scroll", () => window.scrollY < 300 && moveInk(null), { passive: true });

/* ---------- link check ---------- */

function renderSuggestions() {
  const box = $("checkSuggest");
  const targets = [...new Set(state.board.alerts.map((a) => a.attrs.target).filter(Boolean))].slice(0, 5);
  const key = targets.join("|");
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = targets.length ? "<span>try:</span>" : "";
  for (const t of targets) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t;
    b.addEventListener("click", () => {
      $("checkInput").value = t;
      runCheck(t);
    });
    box.append(b);
  }
}

function runCheck(input, { quiet = false } = {}) {
  if (!state.board) return;
  state.lastCheck = input;
  const r = checkTarget(state.board, input);
  const box = $("checkResult");
  box.hidden = false;
  const level = r.level === "invalid" ? "caution" : r.level;
  box.className = `result ${level}`;
  const icon = { danger: "!", caution: "?", clear: "✓" }[level];
  const items = r.matches
    .map(
      (a) =>
        `<li class="${a.verdict.status}"><b>${escapeHtml(LABELS[a.verdict.status])}</b> · ${escapeHtml(a.payload?.title ?? "")} <span class="muted">(${escapeHtml(a.verdict.issuer)})</span></li>`,
    )
    .join("");
  box.innerHTML = `
    <div class="verdict-icon">${icon}</div>
    <div>
      <h3>${escapeHtml(r.headline)}</h3>
      <p>${escapeHtml(r.detail)}</p>
      ${items ? `<ul>${items}</ul>` : ""}
      ${r.host ? `<div class="q mono">query · ${escapeHtml(Q.target(r.host))}</div>` : ""}
    </div>`;
  if (!quiet) {
    if (r.level === "danger") state.seal?.stamp();
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

$("checkForm").addEventListener("submit", (e) => {
  e.preventDefault();
  runCheck($("checkInput").value);
});

/* ---------- wiring ---------- */

$("modeReplay").addEventListener("click", () => state.mode !== "replay" && startReplay());
$("modeLive").addEventListener("click", () => state.mode !== "live" && startLive());
$("attackBtn").addEventListener("click", attack);
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", async () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t === tab));
    placeThumbs();
    state.filter = tab.dataset.filter;
    if (state.mode === "live") await refreshServerVerified().catch((e) => notice(e.message, "err"));
    else state.serverVerifiedKeys = null;
    render();
  });
}
if (CONFIG.repo) $("repoLink").href = CONFIG.repo;

/* ---------- read it without us (idea credit: Mirrorlease's "Read it without us" page) ---------- */

const curl = `curl -s ${CONFIG.rpcHttp} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["${Q.all().replaceAll("'", "'\\''")}",{"select":{"key":true,"creator":true,"attributes":true,"payload":true}}]}'`;
$("curlSnippet").textContent = curl + `\n\n# Trust only grants/revokes whose creator is the root:\n# ${CONFIG.root}`;
$("copyCurl").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(curl);
    $("copyCurl").querySelector("span").textContent = "Copied";
  } catch {
    $("copyCurl").querySelector("span").textContent = "Select and copy";
  }
});

mountHero();
const params = new URLSearchParams(location.search);
if (params.get("mode") === "live") startLive();
else startReplay();
