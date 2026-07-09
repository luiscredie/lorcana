# Ranger Atlas — save server setup (one time, ~4 minutes)

Reading works on every device with NO setup. This is only needed to SAVE changes
(log games, edit decks) without putting a GitHub token in any browser.

## Steps
1. **GitHub token** — github.com → Settings → Developer settings → *Fine-grained
   personal access tokens* → **Generate new token**.
   - Repository access → *Only select repositories* → **luiscredie/lorcana**
   - Permissions → **Contents: Read and write**
   - Generate and copy the token.
2. **Cloudflare Worker** — dash.cloudflare.com (free account) → *Workers & Pages* →
   **Create** → *Create Worker* → give it a name (e.g. `lorcana-atlas`) → **Deploy**.
   - Click **Edit code**, delete the sample, paste all of `cloudflare-worker.js`, **Deploy**.
3. **Add the secret** — the Worker's **Settings → Variables and Secrets** →
   **Add** a *Secret* named `GH_TOKEN` with your token as the value → Save/Deploy.
4. **Copy the Worker URL** (looks like `https://lorcana-atlas.<you>.workers.dev`).
   Open the app → the **Sync** chip in the header → paste the URL → **Save**.

That device can now save; every other device sees the changes automatically (it
re-pulls on load and whenever you switch back to the tab).

Tip: send me the Worker URL and I can bake it into the app so no device needs even
this one paste.
