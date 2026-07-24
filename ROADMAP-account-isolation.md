# Roadmap — shared cardbase and per-user data

## Goal

Keep the cardbase, images and prices shared by the site while isolating each
account's collection, exact printings, decks, games and preferences.

## Tasks and acceptance criteria

- [x] **1. Establish the data boundary**
  - Shared: cardbase, catalogue, images and prices.
  - Per user: collection, exact printings, decks, games, variants, inkable
    overrides, notes and wishlist.

- [x] **2. Make collection imports account-specific**
  - The command-line importer requires an explicit `--user-data` target.
  - Dreamborn CSV parsing supports BOM, quoted fields, commas and escaped quotes.
  - Normal and foil quantities remain separate.
  - Importing one account preserves its unrelated decks, games and preferences.

- [x] **3. Remove ownership from the shared catalogue**
  - `card-catalog-master.json` contains no ownership counters or collection flag.
  - The current catalogue validates to 3,442 records and 19 editions.

- [x] **4. Isolate browser storage and synchronization**
  - All owned-data keys include the canonical signed-in username.
  - New accounts do not inherit the primary user's collection or games.
  - User data reads and writes go only through the authenticated Worker.
  - The retired unauthenticated sync endpoint returns HTTP 410.

- [x] **5. Enforce server-side account boundaries**
  - Signed sessions bind the role and canonical username.
  - Admin/editor accounts can write only their configured file.
  - Viewer accounts cannot write.
  - Removed accounts and revoked editing roles are rechecked on every request.
  - Canonical usernames prevent normalized-key collisions.

- [x] **6. Scope the simulator**
  - Saved game state, decks and inkable overrides use only the current account.
  - The simulator no longer scans other account namespaces or public user files.

- [x] **7. Validate collection and pricing data**
  - 528 exact owned rows, 414 consolidated names and 2,038 copies.
  - 1,854 normal and 184 foil copies.
  - No owned printing is missing its shared catalogue record or image URL.
  - No known name-mismatched price is indexed as an exact match.

- [x] **8. Add repeatable checks**
  - Run `node validate-site.mjs`.
  - Run `git diff --check`.
  - Test the Worker with editor, viewer and KV-only accounts.

- [ ] **9. Release**
  - Review and merge the GitHub pull request.
  - Let GitHub Pages publish the merged site.
  - Replace and deploy the Worker code in Cloudflare.
  - Configure `USERS` or `USERS_KV`, `SESSION_SECRET` and `GH_TOKEN`.
  - Verify two real accounts end to end.

## Privacy note

Account isolation prevents accidental mixing inside the application. Because the
repository is public, JSON files committed under `data/` are still publicly
downloadable. Move per-user documents to private server-side storage before
storing information that must be confidential.
