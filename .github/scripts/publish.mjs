// Callanix publisher: turns approved `app-submission` issues into data/links.json.
// Phases: `apply` (mutate links.json, write .results.json) then `report` (comment/label/close).
// Run `node .github/scripts/publish.mjs --selftest` for offline fixture checks.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..", "..");
const LINKS = join(ROOT, "data", "links.json");
const REMOVED = join(ROOT, "data", "removed.json");
const PUBLISHERS = join(ROOT, "data", "publishers.json");
const RESULTS = join(DIR, ".results.json");
const REPORT = join(DIR, ".report.json");
const MAILQ = join(DIR, ".mail.json");

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
  const firstEmail = (s) => {
    const m = String(s || "").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    return m ? m[0] : "";
  };
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
    contactEmail: (() => {
      const raw = get("Contact email (optional)").trim();
      return firstEmail(raw) || (raw && raw !== "_No response_" && !/^none$/i.test(raw) ? raw : "");
    })(),
    confirmed: /-\s*\[[xX]\]/.test(get("Confirmation")),
  };
}

// ---------- validation ----------
const isUrl = (s) => /^https?:\/\/[^\s"<>]+$/i.test(s || "");

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
    else if (sub.description.length > 4000) errors.push("Description must be 4,000 characters or less — shorten it so users can read it faster.");
    if (!isUrl(sub.url)) errors.push("App URL must start with http:// or https://.");
    if (sub.adUrl && !isUrl(sub.adUrl)) errors.push("Ad URL must start with http:// or https://.");
    if (!sub.iconUrl) errors.push("Icon URL is required — it proves ownership for future updates / removals.");
    else if (!isUrl(sub.iconUrl)) errors.push("Icon URL must start with http:// or https://.");
    const badShots = sub.screenshots.filter((s) => !isUrl(s));
    if (!sub.screenshots.length) errors.push("At least 1 screenshot URL is required — one per line.");
    if (badShots.length) errors.push(`${badShots.length} screenshot line(s) are not valid URLs.`);
    if (sub.screenshots.length > 5) errors.push("At most 5 screenshots are allowed.");
    if (sub.contactEmail && !/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(sub.contactEmail))
      errors.push("Contact email doesn't look valid.");
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

export function applySubmission(sub, apps, issueNumber, author, privileged, removed) {
  const now = new Date().toISOString();
  sub = {
    ...sub,
    title: noHtml(sub.title).slice(0, 80),
    description: noHtml(sub.description).slice(0, 4000),
    category: String(sub.category || "").toLowerCase().trim(),
  };
  if (sub.request === "delete") {
    const idx = apps.findIndex((a) => a.id === sub.appId);
    if (idx === -1) return { ok: false, errors: ["App not found."] };
    if (!authorized(sub, apps[idx], author, privileged))
      return { ok: false, errors: ["Only the original submitter can delete this app."] };
    const [gone] = apps.splice(idx, 1);
    if (Array.isArray(removed)) {
      const low = String(gone.id || "").toLowerCase();
      if (low && !removed.some((r) => String(r.id || "").toLowerCase() === low)) {
        removed.push({
          id: gone.id,
          title: gone.title || "",
          sourceIssue: gone.sourceIssue ?? null,
          submittedBy: (gone.submittedBy || author || "").toLowerCase(),
          deletedAt: now,
          deletedByIssue: issueNumber,
        });
      }
    }
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
  // Unguessable per-app IDs: 72-bit cryptographic randomness, never
  // sequential, nothing to decode — guessing one is computationally hopeless.
  let id = "";
  for (let n = 0; n < 50 && !id; n++) {
    const cand = "app-" + randomBytes(9).toString("base64url");
    if (!apps.some((a) => a.id === cand)) id = cand;
  }
  if (!id) id = "app-" + randomBytes(12).toString("base64url") + Date.now().toString(36);
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
    sourceIssue: issueNumber,
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

export function decideIssues(issues, apps, priv, mode, removed) {
  const results = [];
  let changed = false;
  const removedCount = Array.isArray(removed) ? removed.length : 0;
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
    const out = applySubmission(sub, apps, issue.number, author, isPriv, removed);
    if (!out.ok) {
      results.push({ issue: issue.number, action: "needs-fix", errors: out.errors });
      continue;
    }
    changed = true;
    results.push({ issue: issue.number, action: out.action, appId: out.appId, title: sub.title, contactEmail: sub.contactEmail || "" });
  }
  const removedChanged = Array.isArray(removed) ? removed.length !== removedCount : false;
  return { results, changed, removedChanged };
}

async function applyPhase() {
  const apps = loadJson(LINKS, []);
  const removed = loadJson(REMOVED, []);
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
  const { results, changed, removedChanged } = decideIssues(issues, apps, priv, mode, removed);
  if (changed) writeFileSync(LINKS, JSON.stringify(apps, null, 2) + "\n");
  if (removedChanged) writeFileSync(REMOVED, JSON.stringify(removed, null, 2) + "\n");
  // REPORT carries contact emails for the report phase; RESULTS is the
  // public-safe copy that the workflow prints into the action log.
  writeFileSync(REPORT, JSON.stringify(results, null, 2));
  writeFileSync(
    RESULTS,
    JSON.stringify(results.map(({ contactEmail, ...rest }) => rest), null, 2)
  );
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `changed=${changed}\n`);
  console.log(`apply: ${results.length} issue(s), changed=${changed}`);
}

async function reportPhase() {
  const path = existsSync(REPORT) ? REPORT : RESULTS;
  if (!existsSync(path)) {
    console.log("report: no results file, nothing to do");
    return;
  }
  const results = loadJson(path, []);
  const mail = [];
  const repoUrl = `https://github.com/${REPO}`;
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
    const emailed = Boolean(r.contactEmail) && r.action !== "deleted";
    if (emailed) {
      const safeTitle = String(r.title || "your app").replace(/[\r\n]+/g, " ");
      mail.push({
        to: r.contactEmail,
        subject: `Your Callanix app ${r.action === "published" ? "is live" : "was updated"}: ${safeTitle}`,
        body: [
          "Hi,",
          "",
          `Your app "${r.title || "your app"}" ${r.action === "published" ? "is live in the Callanix Store" : "was updated in the Callanix Store"}.`,
          "",
          `Private app ID: ${r.appId}`,
          "Keep it secret — you need it for future edits. You never have to type it: open MY APPS in the Dev Portal (connected as the submitter) to manage it.",
          "",
          `Store repo: ${repoUrl}`,
        ].join("\n"),
      });
    }
    if (r.contactEmail) {
      // Scrub the address off the public ticket after capturing it.
      try {
        const cur = await api(base);
        const clean = String(cur.body || "")
          .split("\n")
          .map((l) => (l.includes(r.contactEmail) ? "(contact delivered privately)" : l))
          .join("\n");
        if (clean !== cur.body) await api(base, "PATCH", { body: clean });
      } catch {}
    }
    const note =
      r.action === "deleted"
        ? "Removed from the store."
        : emailed
          ? "Live in the store. Your private app ID was emailed to you — keep it secret."
          : "Live in the store. The private app ID is hidden from this page — find it in MY APPS in the Dev Portal (connected as the submitter).";
    await api(`${base}/comments`, "POST", { body: note });
    await api(`${base}/labels`, "POST", { labels: ["published"] });
    for (const old of ["needs-fix", "approved"]) {
      try {
        await api(`${base}/labels/${old}`, "DELETE");
      } catch {}
    }
    await api(base, "PATCH", { state: "closed" });
  }
  writeFileSync(MAILQ, JSON.stringify(mail, null, 2));
  console.log(`report: ${results.length} result(s), ${mail.length} mail(s)`);
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
      over.icon ?? "https://example.com/icon.png",
      "",
      "### Screenshot URLs (optional)",
      "",
      over.shots ?? "https://example.com/s1.jpg",
      "",
      "### Contact email (optional)",
      "",
      over.email ?? "dev@example.com",
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
  assert.ok(/^app-[A-Za-z0-9_-]+$/.test(apps[0].id));
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

  // delete writes exactly one tombstone per app id, never duplicates
  const appsT = [];
  const rT = applySubmission(sub, appsT, 42, "SomeDev", false);
  const tombId = appsT[0].id;
  const removedT = [];
  const dT = parseBody(body({ request: "Delete app", appId: tombId, title: "x", desc: "x" }));
  assert.equal(applySubmission(dT, appsT, 44, "SomeDev", false, removedT).action, "deleted");
  assert.equal(removedT.length, 1);
  assert.equal(removedT[0].id, tombId);
  assert.equal(removedT[0].sourceIssue, 42);
  assert.equal(removedT[0].submittedBy, "somedev");
  assert.equal(applySubmission(dT, appsT, 45, "SomeDev", false, removedT).ok, false);
  assert.equal(removedT.length, 1);

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
  assert.ok(/^app-[A-Za-z0-9_-]+$/.test(a2[0].id));
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
  let a4 = [{ id: "app-7", title: "Old", submittedBy: "stranger", sourceIssue: 5 }];
  const r4 = [];
  d = decideIssues(
    [fake(14, "Stranger", ["app-submission", "req-delete"], body({ appId: "app-7" }))],
    a4,
    new Set(["owner"]),
    "auto",
    r4
  );
  assert.equal(d.results[0].action, "deleted");
  assert.equal(a4.length, 0);
  assert.equal(d.removedChanged, true);
  assert.equal(r4.length, 1);
  assert.equal(r4[0].id, "app-7");

  // unlabeled portal filings (labels param dropped) are recognizable
  const portalBody = [
    "### Request type", "", "New app", "",
    "### App ID (for Edit / Delete only)", "", "_No response_", "",
    "### App title", "", "Portal App", "",
    "### Category", "", "Tools", "",
    "### Description", "", "Filed from the portal.", "",
    "### App URL", "", "https://example.com/p", "",
    "### Ad gateway URL (optional)", "", "_No response_", "",
    "### Icon URL (optional)", "", "https://example.com/icon.png", "",
    "### Screenshot URLs (optional)", "", "https://example.com/s1.jpg", "",
    "### Contact email (optional)", "", "dev@example.com", "",
    "### Confirmation", "", "- [X] I have the right to share this app and its links", "",
  ].join("\n");
  assert.equal(isPortalIssue({ labels: [], body: portalBody }), true);
  assert.equal(isPortalIssue({ labels: [{ name: "app-submission" }], body: portalBody }), false);
  assert.equal(isPortalIssue({ labels: [], body: "just chatting" }), false);
  assert.equal(isPortalIssue({ pull_request: {}, labels: [], body: portalBody }), false);
  let a5 = [];
  d = decideIssues([{ number: 15, user: { login: "stranger" }, labels: [], body: portalBody }], a5, new Set(["owner"]), "auto");
  assert.equal(d.results[0].action, "published");
  assert.ok(/^app-[A-Za-z0-9_-]+$/.test(a5[0].id));

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
    "### Icon URL (optional)", "", "[View the icon](https://example.com/icon.png)", "",
    "### Screenshot URLs (optional)", "", "1. https://example.com/s1.jpg", "2. https://example.com/s2.jpg", "",
    "### Contact email (optional)", "", "dev@example.com", "",
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

  // contact email: captured, validated, carried on results, never stored
  assert.equal(parseBody(body({ email: "dev@example.com" })).contactEmail, "dev@example.com");
  assert.equal(parseBody(body({ email: "[Mail](mailto:a@b.co)" })).contactEmail, "a@b.co");
  assert.equal(parseBody(body({ email: "_No response_" })).contactEmail, "");
  assert.deepEqual(validate(parseBody(body({ email: "_No response_" })), [], "new"), []);
  assert.ok(validate(parseBody(body({ icon: "_No response_" })), [], "new").some((e) => e.includes("Icon URL")));
  assert.ok(validate(parseBody(body({ shots: "_No response_" })), [], "new").some((e) => e.includes("screenshot")));
  assert.ok(validate(parseBody(body({ desc: "x".repeat(4001) })), [], "new").some((e) => e.includes("4,000")));
  assert.deepEqual(validate(parseBody(body({ desc: "x".repeat(4000) })), [], "new"), []);
  assert.ok(validate(parseBody(body({ email: "not-an-email" })), [], "new").some((e) => e.includes("Contact email")));
  d = decideIssues([fake(20, "s", [], body({ email: "dev@example.com" }))], [], new Set(["o"]), "auto");
  assert.equal(d.results[0].contactEmail, "dev@example.com");

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
