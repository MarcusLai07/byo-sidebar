// GitHub pull requests through the gh CLI's existing logins (no token to paste).
// Every account `gh auth login` knows about is read, so work and personal PRs
// show up together. Tokens stay in the router; the extension only gets PR data.

const { execFile } = require("child_process");

const GH = process.env.LUMEN_GH_BIN || "gh";
const API = "https://api.github.com/graphql";

function gh(args, token) {
  return new Promise((resolve, reject) =>
    execFile(GH, args, { timeout: 30000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, ...(token && { GH_TOKEN: token }) } }, (err, stdout, stderr) => {
      if (err?.code === "ENOENT") return reject(new Error("GitHub CLI not found: brew install gh, then gh auth login, then re-run the installer."));
      if (err) return reject(new Error(String(stderr || err.message).trim().split("\n").pop()));
      resolve(String(stdout));
    })
  );
}

// [{ login, token }] for every signed-in github.com account, the active one first.
let accountsCache = null;
async function accounts() {
  if (accountsCache) return accountsCache;
  const status = JSON.parse(await gh(["auth", "status", "--json", "hosts"]));
  const list = (status.hosts?.["github.com"] || []).filter((a) => a.state === "success").sort((a, b) => b.active - a.active);
  if (!list.length) throw new Error("Not signed in to GitHub: run gh auth login.");
  accountsCache = await Promise.all(list.map(async (a) => ({ login: a.login, token: (await gh(["auth", "token", "--user", a.login])).trim() })));
  return accountsCache;
}

async function graphql(token, query, variables = {}, retry = true) {
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "lumen" },
    body: JSON.stringify({ query, variables }),
  }).catch((e) => {
    if (retry) return null; // a network blip: try once more
    throw e;
  });
  if (!res) return graphql(token, query, variables, false);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) throw new Error(body.errors?.[0]?.message || body.message || `GitHub ${res.status}`);
  return body.data;
}

const PR_FIELDS = `
  ... on PullRequest {
    url number title isDraft updatedAt reviewDecision headRefName
    repository { nameWithOwner }
    author { login }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }`;
const SEARCHES = {
  review: "is:pr is:open archived:false review-requested:@me",
  mine: "is:pr is:open archived:false author:@me",
  assigned: "is:pr is:open archived:false assignee:@me",
};
const PRS_QUERY = `query {
  ${Object.entries(SEARCHES).map(([k, q]) => `${k}: search(query: ${JSON.stringify(q)}, type: ISSUE, first: 40) { nodes { ${PR_FIELDS} } }`).join("\n  ")}
}`;

const CI = { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail", PENDING: "pending", EXPECTED: "pending" };

// Open PRs across accounts: [{ url, title, repo, number, author, draft, updatedAt,
// review, ci, branch, group: "review" | "mine" | "assigned", account }]. A PR in more
// than one search keeps the first group (review requests matter most).
async function prs() {
  const accts = await accounts();
  const out = new Map();
  const errors = [];
  await Promise.all(
    accts.map(async (a) => {
      try {
        const data = await graphql(a.token, PRS_QUERY);
        for (const group of Object.keys(SEARCHES)) {
          for (const n of data[group]?.nodes || []) {
            if (!n?.url) continue;
            const prev = out.get(n.url);
            if (prev && Object.keys(SEARCHES).indexOf(prev.group) <= Object.keys(SEARCHES).indexOf(group)) continue;
            out.set(n.url, {
              url: n.url,
              title: n.title,
              repo: n.repository.nameWithOwner,
              number: n.number,
              author: n.author?.login || "",
              draft: n.isDraft,
              updatedAt: n.updatedAt,
              review: n.reviewDecision, // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
              ci: CI[n.commits.nodes[0]?.commit.statusCheckRollup?.state] || null,
              branch: n.headRefName,
              group,
              account: a.login,
            });
          }
        }
      } catch (e) {
        errors.push(`${a.login}: ${e.message}`);
      }
    })
  );
  if (errors.length === accts.length) throw new Error(errors.join("; "));
  return { accounts: accts.map((a) => a.login), items: [...out.values()], errors };
}

// The token of the first account that can see this PR's repo.
async function tokenFor(url) {
  for (const a of await accounts()) {
    try {
      await graphql(a.token, "query($u: URI!) { resource(url: $u) { __typename } }", { u: url }).then((d) => {
        if (!d.resource) throw new Error("not visible");
      });
      return a.token;
    } catch {}
  }
  throw new Error("None of your GitHub accounts can see that pull request.");
}

// { url: "OPEN" | "MERGED" | "CLOSED" | null } for PRs that left the open lists.
async function states(urls) {
  const out = {};
  const accts = await accounts();
  await Promise.all(
    urls.slice(0, 30).map(async (u) => {
      for (const a of accts) {
        const d = await graphql(a.token, "query($u: URI!) { resource(url: $u) { ... on PullRequest { state } } }", { u }).catch(() => null);
        if (d?.resource?.state) return (out[u] = d.resource.state);
      }
      out[u] = null;
    })
  );
  return out;
}

const isPrUrl = (url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url || "");
const prUrl = (url) => url.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)[0];

async function checks(url) {
  const token = await tokenFor(prUrl(url));
  const out = await gh(["pr", "checks", prUrl(url), "--json", "name,state,bucket,link,workflow"], token).catch((e) => {
    if (/no checks/i.test(e.message)) return "[]";
    throw e;
  });
  return JSON.parse(out || "[]");
}

// Re-runs the failed jobs of each GitHub Actions run with a failed check.
async function rerunFailed(url) {
  const token = await tokenFor(prUrl(url));
  const repo = prUrl(url).split("/").slice(3, 5).join("/");
  const runs = new Set();
  const others = []; // failed checks from other services (Vercel, CircleCI…): not ours to re-run
  for (const c of await checks(url)) {
    if (c.bucket !== "fail") continue;
    const m = c.link?.match(/\/actions\/runs\/(\d+)/);
    m ? runs.add(m[1]) : others.push(c.name);
  }
  for (const id of runs) await gh(["run", "rerun", id, "--failed", "-R", repo], token);
  return { rerun: runs.size, others };
}

async function diff(url) {
  const token = await tokenFor(prUrl(url));
  const [view, patch] = await Promise.all([
    gh(["pr", "view", prUrl(url), "--json", "title,headRefName,baseRefName,additions,deletions,changedFiles"], token).then(JSON.parse),
    gh(["pr", "diff", prUrl(url)], token),
  ]);
  return { ...view, diff: patch };
}

async function info(url) {
  const token = await tokenFor(prUrl(url));
  return JSON.parse(await gh(["pr", "view", prUrl(url), "--json", "title,headRefName,baseRefName,headRepository,headRepositoryOwner"], token));
}

// action → handler; every handler that takes a URL needs a PR URL.
const ACTIONS = { prs, states: (i) => states(i.urls || []), checks: (i) => checks(i.url), rerunFailed: (i) => rerunFailed(i.url), diff: (i) => diff(i.url), info: (i) => info(i.url) };

async function run(action, input = {}) {
  const fn = ACTIONS[action];
  if (!fn) throw new Error(`Unknown GitHub action ${action}`);
  if ("url" in input && !isPrUrl(input.url)) throw new Error("That isn't a GitHub pull request page.");
  return fn(input);
}

module.exports = { run };
