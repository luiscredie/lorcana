# Price agent contract — exact Lorcana printings

## Goal

Generate a price for each physical printing, identified by its exact
`LigaLorcana ID`. A card name is not a unique identifier: the same name can
exist in different sets, promos, Enchanted/Epic versions and finishes.

## Required identity

Every collected printing must preserve:

```json
{
  "liga_id": "LOR4-138",
  "edition": "LOR4",
  "number": "138",
  "name": "Anna - True-Hearted",
  "normal": {"low": 3.49, "average": 4.10, "high": 5.00},
  "foil": {"low": 5.99, "average": 8.44, "high": 9.90},
  "match_status": "matched",
  "source_url": "https://www.ligalorcana.com.br/..."
}
```

`liga_id` is the primary key. `edition + number + name` is validation data, not
a replacement key.

## Collection rules

1. Enumerate exact Liga printings from `cards.json` (or discovery) and resolve
   every `ligaId` against `card-catalog-master.json`; never use the single
   representative printing in `card-db.js` as the primary identity.
2. Query LigaLorcana with that printing's exact edition, card number and Liga
   name.
3. Preserve non-numeric promo numbers such as `10-C2`; never reduce them to
   `10`.
4. Validate the returned normalized name against the requested catalogue row.
5. If the response belongs to another card, write `matched_name_mismatch` and
   never attach that price to the requested `liga_id`.
6. Collect normal and foil independently. A missing foil price must stay
   `null`; it must not inherit the normal price.
7. Store every failed exact printing in `unresolved` with its `liga_id`,
   edition, number, expected name, reason and attempted URL.
8. Reprints and promos may be grouped for presentation, but the exact
   `liga_id` records must remain independently addressable.

## Recommended schema

The existing grouped `prices` object may remain for backward compatibility,
but the agent should also emit a direct index:

```json
{
  "schema_version": 4,
  "prices_by_liga_id": {
    "LOR4-138": {
      "liga_id": "LOR4-138",
      "edition": "LOR4",
      "number": "138",
      "name": "Anna - True-Hearted",
      "normal": {"low": 3.49, "average": 4.10, "high": 5.00},
      "foil": {"low": 5.99, "average": 8.44, "high": 9.90},
      "match_status": "matched",
      "source_url": "https://www.ligalorcana.com.br/..."
    }
  }
}
```

`price_agent.py` now emits this direct index and retains the grouped `prices`
object only for backward compatibility. The site gives the direct schema-v4
entry precedence whenever both forms exist.

## Mandatory regression cases

| Requested printing | Expected result |
| --- | --- |
| `LOR4-138` Anna - True-Hearted | Match Anna from set 4 |
| `LOR9-137` Anna - True-Hearted | Match Anna from set 9 |
| `LOR9-138` while requesting Anna | Reject: this is Huey - Savvy Nephew |
| `DLPC1-10-C2` Let It Go (Disney Lorcana Challenge) | Independent promo price |
| `DLPC1-2-C1` Let It Go | Independent promo price; never reuse for `10-C2` |
| `LOR1-163` and `LOR11-163` Let It Go | Two independent regular-set prices |

The agent run must fail validation if any exact `liga_id` is duplicated or if a
name-mismatched response enters the exact-price index.

Run the offline regression suite with:

```bash
python3 validate-price-agent.py
node validate-site.mjs
```
