function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "https://luiscredie.github.io",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubRead(env) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const path = env.GITHUB_PATH || "atlas-data.json";

  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

  return fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "lorcana-cloud-sync"
    }
  });
}

async function githubWrite(env, bodyText) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const path = env.GITHUB_PATH || "atlas-data.json";

  const readResponse = await githubRead(env);

  let sha = null;

  if (readResponse.ok) {
    const current = await readResponse.json();
    sha = current.sha;
  } else if (readResponse.status !== 404) {
    throw new Error(`GitHub read failed: ${readResponse.status} ${await readResponse.text()}`);
  }

  const payload = {
    message: `Update Lorcana atlas data ${new Date().toISOString()}`,
    content: toBase64(bodyText),
    branch
  };

  if (sha) {
    payload.sha = sha;
  }

  const url =
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  return fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "lorcana-cloud-sync",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    try {
      if (request.method === "GET") {
        const gh = await githubRead(env);

        if (!gh.ok) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: await gh.text()
            }),
            {
              status: gh.status,
              headers
            }
          );
        }

        const data = await gh.json();
        const text = fromBase64(data.content || "");

        return new Response(text, { headers });
      }

      if (request.method === "POST" || request.method === "PUT") {
        const bodyText = await request.text();

        // Make sure the saved file is valid JSON before writing to GitHub.
        JSON.parse(bodyText);

        const gh = await githubWrite(env, bodyText);

        if (!gh.ok) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: await gh.text()
            }),
            {
              status: gh.status,
              headers
            }
          );
        }

        return new Response(
          JSON.stringify({ ok: true }),
          { headers }
        );
      }

      return new Response(
        JSON.stringify({
          ok: false,
          error: "Method not allowed"
        }),
        {
          status: 405,
          headers
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: String(err.message || err)
        }),
        {
          status: 500,
          headers
        }
      );
    }
  }
};