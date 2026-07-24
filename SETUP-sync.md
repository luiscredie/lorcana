# Ranger Atlas — authenticated per-user sync

The site uses `cloudflare-worker.js` as its only data gateway. The cardbase,
catalogue and prices are shared, while every account is mapped to a separate
JSON document containing that user's collection, decks, games and preferences.

## 1. GitHub token

Create a fine-grained personal access token in GitHub:

1. Open **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Limit repository access to **luiscredie/lorcana**.
3. Grant **Contents: Read and write**.
4. Copy the token. Never add it to this repository or to browser code.

## 2. Cloudflare Worker

1. In Cloudflare, open **Workers & Pages** and create or select the Worker.
2. Replace its code with the complete contents of `cloudflare-worker.js`.
3. Add these values under **Settings → Variables and Secrets**:

| Name | Type | Purpose |
| --- | --- | --- |
| `GH_TOKEN` | Secret | Writes the authenticated user's JSON file in GitHub |
| `SESSION_SECRET` | Secret | Long random value used to sign one-hour sessions |
| `USERS` | Secret | JSON account table, described below |

Optional plain variables are `GH_OWNER`, `GH_REPO`, `GH_BRANCH` and `GH_PATH`.
The defaults already target `luiscredie/lorcana`, branch `main`, with
`atlas-data.json` as the primary account's file.

## 3. Account table and permissions

`USERS` is a JSON object. Each account receives its own data file:

```json
{
  "luiscredie": {
    "pass": "replace-with-a-strong-password",
    "role": "admin"
  },
  "another-user": {
    "pass": "replace-with-another-strong-password",
    "role": "editor"
  },
  "read-only-user": {
    "pass": "replace-with-a-third-strong-password",
    "role": "viewer"
  }
}
```

- `admin` and `editor` may modify only the data file associated with their own
  signed session.
- `viewer` may read only their own data and cannot save changes.
- `luiscredie` uses `atlas-data.json`.
- Other usernames use `data/<normalized-username>.json`.
- Usernames must be 1–64 lowercase characters using only `a-z`, `0-9`, `_`
  and `-`. This prevents two accounts from resolving to the same browser key
  or default data file.
- An account may specify a safe relative `"file": "data/custom.json"` override.
  Every override must be unique to that account.

For account management without changing the `USERS` secret, bind a Cloudflare
KV namespace as `USERS_KV`. Store one username per key and the corresponding
account object as its JSON value. KV accounts take precedence over `USERS`.

## 4. Privacy boundary

The repository and GitHub Pages site are public. Account separation prevents
the application from mixing users, but JSON files committed to this public
repository can still be downloaded directly from GitHub by anyone who knows
their path. Do not store passwords, access tokens or other sensitive personal
information in these documents.

If collection confidentiality is required, move the per-user documents to
private server-side storage (for example, Cloudflare KV, D1 or R2) and keep only
the shared cardbase in the public repository. That storage migration is
separate from the account-isolation change documented here.

## 5. Deploy and verify

Deploy the Worker, then verify:

1. A valid account can log in.
2. An `editor` can import a collection and save it.
3. A second account starts with its own collection and game history.
4. A `viewer` can open the site but cannot edit.
5. No request to the retired `/functions/sync` endpoint is used.

The production site already has the Worker URL configured in `index.html`.
Changing that URL should be done only when the Worker address changes.

## Importing a user's collection from the command line

The importer requires the target user document explicitly:

```bash
node import-collection.mjs \
  --master uploads/lorcana_card_database_master.csv \
  --map uploads/mapeamento_dreamborn_ligalorcana.csv \
  --user-data atlas-data.json
```

For another account, replace the final path with `data/<user>.json`. The command
rebuilds that user's `collection` and `collectionPrintings`, preserves decks,
games and other fields, and refreshes the shared `card-catalog-master.json`
without embedding ownership data in the cardbase.
