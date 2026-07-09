// Ranger Atlas save server — Cloudflare Worker (free).
// Holds your GitHub token as a SECRET so no browser ever sees it.
//
// SETUP (one time, ~4 min):
// 1. Make a fine-grained GitHub token: github.com -> Settings -> Developer settings ->
//    Fine-grained personal access tokens -> Generate. Repository access: only
//    luiscredie/luiscredie.github.io. Permissions: Contents = Read and write. Copy it.
// 2. dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker -> name it
//    (e.g. "lorcana-atlas") -> Deploy. Then "Edit code", paste THIS whole file, Deploy.
// 3. Worker -> Settings -> Variables and Secrets -> Add a SECRET named GH_TOKEN =
//    your token. (Optional plain vars: GH_OWNER, GH_REPO, GH_BRANCH, GH_PATH — defaults below.)
// 4. Copy the Worker URL (https://lorcana-atlas.<you>.workers.dev). In the app's Sync
//    panel, paste it and press Save. (Send it to me and I can bake it in so no device
//    needs any setup.)

const CFG = (env) => ({
  owner:  env.GH_OWNER  || "luiscredie",
  repo:   env.GH_REPO   || "luiscredie.github.io",
  branch: env.GH_BRANCH || "main",
  path:   env.GH_PATH   || "lorcana/atlas-data.json",
});
const ALLOW = "https://luiscredie.github.io"; // set to "*" to allow any origin

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOW === "*" ? (origin || "*") : ALLOW,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) },
  });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    const c = CFG(env);
    const api = "https://api.github.com/repos/" + c.owner + "/" + c.repo + "/contents/" + c.path;
    const gh = (extra) => ({
      "Authorization": "Bearer " + env.GH_TOKEN,
      "Accept": "application/vnd.github+json",
      "User-Agent": "ranger-atlas-worker",
      ...(extra || {}),
    });

    try {
      if (request.method === "GET") {
        const r = await fetch(api + "?ref=" + c.branch + "&t=" + Date.now(), { headers: gh() });
        if (r.status === 404) return json({ doc: null, sha: null }, 200, origin);
        if (!r.ok) return json({ error: "read " + r.status }, 502, origin);
        const j = await r.json();
        let doc = null;
        try { doc = JSON.parse(decodeURIComponent(escape(atob(String(j.content).replace(/\s/g, ""))))); } catch (e) {}
        return json({ doc, sha: j.sha }, 200, origin);
      }

      if (request.method === "POST") {
        if (!env.GH_TOKEN) return json({ error: "server missing GH_TOKEN secret" }, 500, origin);
        const body = await request.json().catch(() => ({}));
        if (typeof body.content !== "string") return json({ error: "no content" }, 400, origin);
        const put = {
          message: "Ranger Atlas sync " + new Date().toISOString(),
          content: btoa(unescape(encodeURIComponent(body.content))),
          branch: c.branch,
        };
        if (body.sha) put.sha = body.sha;
        const r = await fetch(api, { method: "PUT", headers: gh({ "Content-Type": "application/json" }), body: JSON.stringify(put) });
        if (r.status === 409 || r.status === 422) return json({ error: "conflict" }, 409, origin);
        if (!r.ok) { const t = await r.text(); return json({ error: "write " + r.status + " " + t.slice(0, 200) }, 502, origin); }
        const j = await r.json();
        return json({ ok: true, sha: j.content && j.content.sha }, 200, origin);
      }

      return json({ error: "method" }, 405, origin);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500, origin);
    }
  },
};
