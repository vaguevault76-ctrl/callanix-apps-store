// Callanix publisher: turns approved `app-submission` issues into data/links.json.
// Phases: `apply` (mutate links.json, write .results.json) then `report` (comment/label/close).
// Run `node .github/scripts/publish.mjs --selftest` for offline fixture checks.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..", "..");
const LINKS = join(ROOT, "data", "links.json");
const PUBLISHERS = join(ROOT, "data", "publishers.json");
const RESULTS = join(DIR, ".results.json");

const CATEGORIES = new Set(["games", "tools", "entertainment", "education", "other"]);
const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPOSITORY || "";
const [OWNER] = REPO.split("/");
const API = "https://api.github.com";

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function api(path, method = "GET", body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub API ${method} ${path}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

// ---------- parsing ----------
export function parseBody(raw) {
  const text = (raw || "").replace(/\r\n/g, "\n");
  const sections = {};
  const parts = text.split(/^### (.+)$/m);
  // parts[0] is preamble; then alternating header, value
  for (let i = 1; i < parts.length; i += 2) {
    sections[parts[i].trim()] = (parts[i + 1] || "").trim();
  }
  const get = (name) => sections[name] || "";
  // Tickets are formatted markdown (bold, code, quotes, links, lists), so
  // values are read through the formatting back to clean data.
  const edge = (s) => String(s || "").replace(/^[*`_~"' \t]+|[*`_~"' \t]+$/g, "");
  const clean = (s) => {
    const t = edge(s).replace(/^_+|_+$/g, "");
    return t === "" || t === "No response" || /^none$/i.test(t) ? "" : t;
  };
  const dequote = (s) =>
    String(s || "")
      .split("\n")
      .map((l) => l.replace(/^\s*>\s?/, ""))
      .join("\n")
      .trim();
  const firstUrl = (s) => {
    const m = String(s || "").match(/https?:\/\/[^\s)>\]]+/);
    return m ? m[0] : "";
  };
  const allUrls = (s) => String(s || "").match(/https?:\/\/[^\s)>\]]+/g) || [];
  return {
    request: get("Request type").toLowerCase().includes("edit")
      ? "edit"
      : get("Request type").toLowerCase().includes("delete")
        ? "delete"
        : "new",
    appId: clean(get("App ID (for Edit / Delete only)").split("\n")[0]),
    title: clean(get("App title").split("\n")[0]),
    category: clean(get("Category").split("\n")[0]).toLowerCase(),
    description: clean(dequote(get("Description"))),
    url: firstUrl(get("App URL")),
    adUrl: firstUrl(get("Ad gateway URL (optional)")),
    iconUrl: firstUrl(get("Icon URL (optional)")),
    screenshots: allUrls(get("Screenshot URLs (optional)")).slice(0, 20),
    confirmed: /-\s*\[[xX]\]/.test(get("Confirmation")),
  };
}

// ---------- validation ----------
const isUrl = (s) => /^https?:\/\/[^\s]+$/i.test(s || "");

export function validate(sub, apps, mode) {
  const errors = [];
  if (!["new", "edit", "delete"].includes(sub.request)) errors.push("Unknown request type.");
  if (mode !== "new") {
    if (!sub.appId) errors.push("App ID is required for Edit / Delete.");
    else if (!apps.some((a) => a.id === sub.appId)) errors.push(`No app found with ID "${sub.appId}".`);
  }
  if (mode !== "delete") {
    if (!sub.title) errors.push("App title is required.");
    else if (sub.title.length > 80) errors.push("Title must be 80 characters or less.");
    if (!CATEGORIES.has(sub.category))
      errors.push(`Category must be one of: ${[...CATEGORIES].join(", ")}.`);
    if (!sub.description) errors.push("Description is required.");
    else if (sub.description.length > 1000) errors.push("Description must be 1000 characters or less.");
    if (!isUrl(sub.url)) errors.push("App URL must start with http:// or https://.");
    if (sub.adUrl && !isUrl(sub.adUrl)) errors.push("Ad URL must start with http:// or https://.");
    if (sub.iconUrl && !isUrl(sub.iconUrl)) errors.push("Icon URL must start with http:// or https://.");
    const badShots = sub.screenshots.filter((s) => !isUrl(s));
    if (badShots.length) errors.push(`${badShots.length} screenshot line(s) are not valid URLs.`);
    if (sub.screenshots.length > 5) errors.push("At most 5 screenshots are allowed.");
    if (!sub.confirmed) errors.push("Confirmation checkbox must be checked.");
  }
  return errors;
}

function authorized(sub, app, author, privileged) {
  if (privileged) return true;
  if (!app) return true; // new apps: anyone may propose; approval gate applies
  return (app.submittedBy || "").toLowerCase() === author.toLowerCase();
}

// ---------- apply ----------
const noHtml = (s) => String(s || "").replace(/<[^>]*>/g, "").trim();

export function applySubmission(sub, apps, issueNumber, author, privileged) {
  const now = new Date().toISOString();
  sub = {
    ...sub,
    title: noHtml(sub.title).slice(0, 80),
    description: noHtml(sub.description).slice(0, 1000),
    category: String(sub.category || "").toLowerCase().trim(),
  };
  if (sub.request === "delete") {
    const idx = apps.findIndex((a) => a.id === sub.appId);
    if (idx === -1) return { ok: false, errors: ["App not found."] };
    if (!authorized(sub, apps[idx], author, privileged))
      return { ok: false, errors: ["Only the original submitter can delete this app."] };
    const [gone] = apps.splice(idx, 1);
    return { ok: true, appId: gone.id, action: "deleted" };
  }
  if (sub.request === "edit") {
    const app = apps.find((a) => a.id === sub.appId);
    if (!app) return { ok: false, errors: ["App not found."] };
    if (!authorized(sub, app, author, privileged))
      return { ok: false, errors: ["Only the original submitter can edit this app."] };
    Object.assign(app, {
      title: sub.title,
      category: sub.category,
      description: sub.description,
      url: sub.url,
      adUrl: sub.adUrl || "",
      iconUrl: sub.iconUrl || app.iconUrl || "",
      screenshots: sub.screenshots.length ? sub.screenshots.slice(0, 5) : app.screenshots || [],
      updatedAt: now,
    });
    return { ok: true, appId: app.id, action: "updated" };
  }
  // Unguessable per-app IDs: random, never sequential, so one dev cannot
  // walk into another dev's apps by trying app-1, app-2, ...
  let id = "";
  for (let n = 0; n < 50 && !id; n++) {
    const cand = "app-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (!apps.some((a) => a.id === cand)) id = cand;
  }
  if (!id) id = "app-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  apps.push({
    id,
    title: sub.title,
    category: sub.category,
    description: sub.description,
    url: sub.url,
    adUrl: sub.adUrl || "",
    iconUrl: sub.iconUrl || "",
    screenshots: sub.screenshots.slice(0, 5),
    createdAt: now,
    updatedAt: now,
    submittedBy: author.toLowerCase(),
  });
  return { ok: true, appId: id, action: "published" };
}

function privilegedUsers() {
  const set = new Set([(OWNER || "").toLowerCase()]);
  for (const u of loadJson(PUBLISHERS, { autoApprove: [] }).autoApprove || [])
    set.add(String(u).toLowerCase());
  set.delete("");
  return set;
}

// "auto" = every valid ticket publishes instantly, no approval taps.
// "approve" = strangers wait for the `approved` label; VIPs skip the wait.
export function publishMode() {
  return loadJson(PUBLISHERS, {}).mode === "approve" ? "approve" : "auto";
}

export function approvedFor({ labels, author, priv, mode }) {
  if (labels.has("approved") || priv.has((author || "").toLowerCase())) return true;
  return mode !== "approve";
}

export const PORTAL_MARKER = "### Request type";

// Portal tickets carry the whole filing in the body. If GitHub ever drops
// the labels param, they arrive unlabeled — still recognizable by marker.
export function isPortalIssue(issue) {
  if (issue.pull_request) return false;
  if ((issue.labels || []).some((l) => l.name === "app-submission")) return false;
  return String(issue.body || "").trimStart().startsWith(PORTAL_MARKER);
}

export function decideIssues(issues, apps, priv, mode) {
  const results = [];
  let changed = false;
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const labels = new Set((issue.labels || []).map((l) => l.name));
    if (labels.has("published")) continue;
    // A fixed ticket must get a second chance: retry `needs-fix` in auto
    // mode, or whenever it carries a fresh `approved` label.
    if (labels.has("needs-fix") && mode === "approve" && !labels.has("approved")) continue;
    const author = (issue.user?.login || "").toLowerCase();
    const isPriv = priv.has(author);
    if (!approvedFor({ labels, author, priv, mode })) {
      results.push({ issue: issue.number, action: "pending" });
      continue;
    }
    const sub = parseBody(issue.body);
    // The ticket's own form declares the request via labels; fall back to
    // the old body section for tickets filed with the retired template.
    if (labels.has("req-edit")) sub.request = "edit";
    else if (labels.has("req-delete")) sub.request = "delete";
    else if (labels.has("req-new")) sub.request = "new";
    const errors = validate(sub, apps, sub.request);
    if (errors.length) {
      results.push({ issue: issue.number, action: "needs-fix", errors });
      continue;
    }
    const out = applySubmission(sub, apps, issue.number, author, isPriv);
    if (!out.ok) {
      results.push({ issue: issue.number, action: "needs-fix", errors: out.errors });
      continue;
    }
    changed = true;
    results.push({ issue: issue.number, action: out.action, appId: out.appId, title: sub.title });
  }
  return { results, changed };
}

async function applyPhase() {
  const apps = loadJson(LINKS, []);
  const priv = privilegedUsers();
  const mode = publishMode();
  const issues = await api(
    `/repos/${REPO}/issues?labels=app-submission&state=open&per_page=100`
  );
  // Safety net: portal filings whose labels were dropped still count.
  try {
    const open = await api(`/repos/${REPO}/issues?state=open&per_page=100`);
    const seen = new Set(issues.map((i) => i.number));
    for (const i of open) {
      if (!seen.has(i.number) && isPortalIssue(i)) issues.push(i);
    }
  } catch {}
  const { results, changed } = decideIssues(issues, apps, priv, mode);
  if (changed) writeFileSync(LINKS, JSON.stringify(apps, null, 2) + "\n");
  writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `changed=${changed}\n`);
  console.log(`apply: ${results.length} issue(s), changed=${changed}`);
}

async function reportPhase() {
  if (!existsSync(RESULTS)) {
    console.log("report: no results file, nothing to do");
    return;
  }
  const results = loadJson(RESULTS, []);
  for (const r of results) {
    if (r.action === "pending") continue;
    const base = `/repos/${REPO}/issues/${r.issue}`;
    if (r.action === "needs-fix") {
      await api(`${base}/comments`, "POST", {
        body: `Needs a fix before publishing:\n\n${r.errors.map((e) => `- ${e}`).join("\n")}\n\nEdit the issue fields above — the robot retries automatically within a few minutes.`,
      });
      await api(`${base}/labels`, "POST", { labels: ["needs-fix"] });
      try {
        await api(`${base}/labels/approved`, "DELETE");
      } catch {}
      continue;
    }
    await api(`${base}/comments`, "POST", {
      body: `Live in the store as \`${r.appId}\` (${r.action}). Thanks for the submission.`,
    });
    await api(`${base}/labels`, "POST", { labels: ["published"] });
    for (const old of ["needs-fix", "approved"]) {
      try {
        await api(`${base}/labels/${old}`, "DELETE");
      } catch {}
    }
    await api(base, "PATCH", { state: "closed" });
  }
  console.log(`report: ${results.length} result(s)`);
}

// ---------- self-test ----------
function selftest() {
  const body = (over = {}) =>
    [
      "### Request type",
      "",
      over.request || "New app",
      "",
      "### App ID (for Edit / Delete only)",
      "",
      over.appId || "_No response_",
      "",
      "### App title",
      "",
      over.title ?? "My Amazing App",
      "",
      "### Category",
      "",
      over.category || "Games",
      "",
      "### Description",
      "",
      over.desc ?? "Does amazing things.",
      "",
      "### App URL",
      "",
      over.url ?? "https://example.com/app",
      "",
      "### Ad gateway URL (optional)",
      "",
      over.adUrl || "_No response_",
      "",
      "### Icon URL (optional)",
      "",
      over.icon || "_No response_",
      "",
      "### Screenshot URLs (optional)",
      "",
      over.shots ?? "https://example.com/s1.jpg",
      "",
      "### Confirmation",
      "",
      over.confirm === false ? "- [ ] I have the right to share this app and its links" : "- [X] I have the right to share this app and its links",
      "",
    ].join("\n");

  // parse new-app body
  const sub = parseBody(body());
  assert.equal(sub.request, "new");
  assert.equal(sub.title, "My Amazing App");
  assert.equal(sub.category, "games");
  assert.equal(sub.url, "https://example.com/app");
  assert.deepEqual(sub.screenshots, ["https://example.com/s1.jpg"]);
  assert.equal(sub.confirmed, true);

  // validate ok
  assert.deepEqual(validate(sub, [], "new"), []);

  // validation failures
  const bad = parseBody(body({ url: "not-a-url", confirm: false, shots: "x\nhttps://ok.com/a.png\ny" }));
  const errs = validate(bad, [], "new");
  assert.ok(errs.some((e) => e.includes("App URL")));
  assert.ok(errs.some((e) => e.includes("Confirmation")));
  assert.deepEqual(bad.screenshots, ["https://ok.com/a.png"]);
  const many = parseBody(body({ shots: "https://a.co/1\nhttps://a.co/2\nhttps://a.co/3\nhttps://a.co/4\nhttps://a.co/5\nhttps://a.co/6" }));
  assert.ok(validate(many, [], "new").some((e) => e.includes("At most 5")));

  // apply new
  const apps = [];
  const r1 = applySubmission(sub, apps, 42, "SomeDev", false);
  assert.equal(r1.ok, true);
  assert.ok(/^app-[a-z0-9]+$/.test(apps[0].id));
  assert.equal(apps[0].submittedBy, "somedev");

  // edit by owner ok, by stranger rejected
  const madeId = apps[0].id;
  const esub = parseBody(body({ request: "Edit app", appId: madeId, title: "Renamed" }));
  assert.deepEqual(validate(esub, apps, "edit"), []);
  assert.equal(applySubmission(esub, apps, 43, "SomeDev", false).ok, true);
  assert.equal(apps[0].title, "Renamed");
  assert.equal(applySubmission(esub, apps, 43, "Stranger", false).ok, false);

  // delete by stranger rejected, by privileged ok
  const dsub = parseBody(body({ request: "Delete app", appId: madeId, title: "x", desc: "x" }));
  assert.equal(applySubmission(dsub, apps, 44, "Stranger", false).ok, false);
  assert.equal(applySubmission(dsub, apps, 44, "anyone", true).action, "deleted");
  assert.equal(apps.length, 0);

  // approval modes
  const priv = new Set(["owner"]);
  assert.equal(approvedFor({ labels: new Set(), author: "stranger", priv, mode: "auto" }), true);
  assert.equal(approvedFor({ labels: new Set(), author: "stranger", priv, mode: "approve" }), false);
  assert.equal(approvedFor({ labels: new Set(["approved"]), author: "stranger", priv, mode: "approve" }), true);
  assert.equal(approvedFor({ labels: new Set(), author: "owner", priv, mode: "approve" }), true);

  // full loop, as the Action runs it
  const fake = (n, author, labels, text) => ({
    number: n,
    user: { login: author },
    labels: labels.map((name) => ({ name })),
    body: text,
  });
  let a2 = [];
  let d = decideIssues([fake(7, "Stranger", [], body())], a2, new Set(["owner"]), "auto");
  assert.equal(d.changed, true);
  assert.ok(/^app-[a-z0-9]+$/.test(a2[0].id));
  assert.equal(d.results[0].action, "published");

  let a3 = [];
  d = decideIssues([fake(8, "Stranger", [], body())], a3, new Set(["owner"]), "approve");
  assert.equal(d.changed, false);
  assert.equal(d.results[0].action, "pending");

  d = decideIssues([fake(9, "Stranger", ["approved"], body())], [], new Set(["owner"]), "approve");
  assert.equal(d.results[0].action, "published");

  d = decideIssues(
    [fake(10, "Stranger", [], body({ url: "bad", confirm: false }))],
    [],
    new Set(["owner"]),
    "auto"
  );
  assert.equal(d.changed, false);
  assert.equal(d.results[0].action, "needs-fix");

  d = decideIssues(
    [fake(11, "Stranger", ["app-submission", "published"], body())],
    [],
    new Set(["owner"]),
    "auto"
  );
  assert.equal(d.results.length, 0);

  // backticked ID pasted from a ticket receipt still matches
  const tick = parseBody(body({ request: "Edit app", appId: "`app-7`", title: "T2" }));
  assert.equal(tick.appId, "app-7");

  // a corrected needs-fix ticket is retried in auto mode, held in approve mode
  const badIssue = [fake(12, "Stranger", ["app-submission", "needs-fix"], body())];
  d = decideIssues(badIssue, [{ id: "app-9" }], new Set(["owner"]), "auto");
  assert.equal(d.results[0].action, "published");
  d = decideIssues(badIssue, [{ id: "app-9" }], new Set(["owner"]), "approve");
  assert.equal(d.results.length, 0);
  d = decideIssues(
    [fake(13, "Stranger", ["app-submission", "needs-fix", "approved"], body())],
    [],
    new Set(["owner"]),
    "approve"
  );
  assert.equal(d.results[0].action, "published");

  // request type comes from the ticket's own form labels, even when the
  // body still says "New app" (retired single template)
  let a4 = [{ id: "app-7", title: "Old", submittedBy: "stranger" }];
  d = decideIssues(
    [fake(14, "Stranger", ["app-submission", "req-delete"], body({ appId: "app-7" }))],
    a4,
    new Set(["owner"]),
    "auto"
  );
  assert.equal(d.results[0].action, "deleted");
  assert.equal(a4.length, 0);

  // unlabeled portal filings (labels param dropped) are recognizable
  const portalBody = [
    "### Request type", "", "New app", "",
    "### App ID (for Edit / Delete only)", "", "_No response_", "",
    "### App title", "", "Portal App", "",
    "### Category", "", "Tools", "",
    "### Description", "", "Filed from the portal.", "",
    "### App URL", "", "https://example.com/p", "",
    "### Ad gateway URL (optional)", "", "_No response_", "",
    "### Icon URL (optional)", "", "_No response_", "",
    "### Screenshot URLs (optional)", "", "_No response_", "",
    "### Confirmation", "", "- [X] I have the right to share this app and its links", "",
  ].join("\n");
  assert.equal(isPortalIssue({ labels: [], body: portalBody }), true);
  assert.equal(isPortalIssue({ labels: [{ name: "app-submission" }], body: portalBody }), false);
  assert.equal(isPortalIssue({ labels: [], body: "just chatting" }), false);
  assert.equal(isPortalIssue({ pull_request: {}, labels: [], body: portalBody }), false);
  let a5 = [];
  d = decideIssues([{ number: 15, user: { login: "stranger" }, labels: [], body: portalBody }], a5, new Set(["owner"]), "auto");
  assert.equal(d.results[0].action, "published");
  assert.ok(/^app-[a-z0-9]+$/.test(a5[0].id));

  // form-style tickets carry no Request-type section; labels decide
  const formBody = portalBody
    .replace("### Request type\n\nNew app\n\n", "")
    .replace("### App ID (for Edit / Delete only)\n\n_No response_", "### App ID (for Edit / Delete only)\n\napp-7");
  let a6 = [{ id: "app-7", title: "Old", category: "tools", description: "d", url: "https://e.com", submittedBy: "stranger" }];
  d = decideIssues(
    [{ number: 16, user: { login: "stranger" }, labels: [{ name: "app-submission" }, { name: "req-edit" }], body: formBody.replace("Portal App", "New Name") }],
    a6,
    new Set(["owner"]),
    "auto"
  );
  assert.equal(d.results[0].action, "updated");
  assert.equal(a6[0].title, "New Name");

  // richly formatted ticket reads back to clean data and publishes
  const fancy = [
    "### Request type", "", "**New app**", "",
    "### App ID (for Edit / Delete only)", "", "_No response_", "",
    "### App title", "", "**Fancy App**", "",
    "### Category", "", "`Tools`", "",
    "### Description", "", "> Does things.", "> Second line.", "",
    "### App URL", "", "[Open the app](https://example.com/a)", "",
    "### Ad gateway URL (optional)", "", "_No response_", "",
    "### Icon URL (optional)", "", "_No response_", "",
    "### Screenshot URLs (optional)", "", "1. https://example.com/s1.jpg", "2. https://example.com/s2.jpg", "",
    "### Confirmation", "", "- [X] I have the right to share this app and its links", "",
  ].join("\n");
  const fs = parseBody(fancy);
  assert.equal(fs.title, "Fancy App");
  assert.equal(fs.category, "tools");
  assert.equal(fs.description, "Does things.\nSecond line.");
  assert.equal(fs.url, "https://example.com/a");
  assert.deepEqual(fs.screenshots, ["https://example.com/s1.jpg", "https://example.com/s2.jpg"]);
  let a7 = [];
  d = decideIssues([{ number: 17, user: { login: "s" }, labels: [], body: fancy }], a7, new Set(["o"]), "auto");
  assert.equal(d.results[0].action, "published");
  assert.equal(a7[0].title, "Fancy App");

  // formatted empties are still empty and rejected
  const emptyFancy = fancy.replace("**Fancy App**", "**_No response_**");
  d = decideIssues([{ number: 18, user: { login: "s" }, labels: [], body: emptyFancy }], [], new Set(["o"]), "auto");
  assert.equal(d.results[0].action, "needs-fix");

  // HTML in text fields is stripped on write
  const h = [];
  applySubmission(
    { ...parseBody(body({ title: "<b>Hi</b>", desc: "<img src=x>Yo" })), request: "new" },
    h,
    99,
    "dev",
    false
  );
  assert.equal(h[0].title, "Hi");
  assert.equal(h[0].description, "Yo");

  console.log("selftest: all fixtures passed");
}

const mode = process.argv[2];
if (mode === "--selftest") selftest();
else if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("publish.mjs")) {
  if (mode === "report") await reportPhase();
  else await applyPhase();
}
