#!/usr/bin/env python3
"""Offline regression checks for price_agent.py.

The scraping dependencies are stubbed because these tests validate identity and
JSON generation only; they never open a browser or access LigaLorcana.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def install_dependency_stubs() -> None:
    bs4 = types.ModuleType("bs4")
    bs4.BeautifulSoup = type("BeautifulSoup", (), {})
    bs4.Tag = type("Tag", (), {})
    sys.modules["bs4"] = bs4

    playwright = types.ModuleType("playwright")
    async_api = types.ModuleType("playwright.async_api")
    async_api.BrowserContext = type("BrowserContext", (), {})
    async_api.Page = type("Page", (), {})
    async_api.async_playwright = lambda: None
    playwright.async_api = async_api
    sys.modules["playwright"] = playwright
    sys.modules["playwright.async_api"] = async_api


def load_agent():
    install_dependency_stubs()
    spec = importlib.util.spec_from_file_location("price_agent", ROOT / "price_agent.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load price_agent.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


agent = load_agent()

cached_catalogue = json.loads((ROOT / "cards.json").read_text(encoding="utf-8"))
supplemented_catalogue, supplemented_count = agent.supplement_cards_from_master(
    cached_catalogue,
    ROOT / "card-catalog-master.json",
)
assert_true(supplemented_count == 8, "The stale Liga discovery cache was not supplemented")
assert_true(
    len({card["id"] for card in supplemented_catalogue}) == 3438,
    "The supplemented catalogue does not cover every unique master ligaId",
)

source_cards = [
    {"id": "LOR4-138", "name": "Anna - True-Hearted", "edition": "LOR4", "number": "138"},
    {"id": "LOR9-137", "name": "Anna - True-Hearted", "edition": "LOR9", "number": "137"},
    {"id": "LOR9-138", "name": "Huey - Savvy Nephew", "edition": "LOR9", "number": "138"},
    {
        "id": "DLPC1-10-C2",
        "name": "Let It Go (Disney Lorcana Challenge)",
        "edition": "DLPC1",
        "number": "10-C2",
    },
    {"id": "DLPC1-2-C1", "name": "Let It Go", "edition": "DLPC1", "number": "2-C1"},
    {"id": "LOR1-163", "name": "Let It Go", "edition": "LOR1", "number": "163"},
    {"id": "LOR11-163", "name": "Let It Go", "edition": "LOR11", "number": "163"},
    {
        "id": "Q1-223",
        "name": "Piglet - Pooh Pirate Captain",
        "edition": "Q1",
        "number": "223",
    },
]

mapped, report = agent.apply_master_catalog_mapping(
    source_cards,
    ROOT / "card-catalog-master.json",
)
by_id = {card["id"]: card for card in mapped}

expected_database_ids = {
    "LOR4-138": "LOR4-138",
    "LOR9-137": "LOR9-137",
    "LOR9-138": "LOR9-138",
    "DLPC1-10-C2": "DLPC1-10-C2",
    "DLPC1-2-C1": "DLPC1-2-C1",
    "LOR1-163": "LOR1-163",
    "LOR11-163": "LOR11-163",
    "Q1-223": "Q1-223--piglet-pooh-pirate-captain",
}
for liga_id, database_id in expected_database_ids.items():
    assert_true(
        by_id[liga_id]["database_id"] == database_id,
        f"{liga_id} mapped to {by_id[liga_id]['database_id']}, expected {database_id}",
    )
    assert_true(
        by_id[liga_id]["catalog_match_status"] == "matched",
        f"{liga_id} did not match the master catalogue exactly",
    )

assert_true(report["summary"].get("matched") == len(source_cards), "Master mapping report is incomplete")

prices = {
    "LOR4-138": (3.49, 5.99),
    "LOR9-137": (2.25, 4.50),
    "LOR9-138": (0.55, 2.69),
    "DLPC1-10-C2": (125.00, None),
    "DLPC1-2-C1": (2999.90, None),
    "LOR1-163": (19.90, 49.90),
    "LOR11-163": (12.99, 26.77),
    "Q1-223": (1.00, None),
}
legacy = {
    "LOR4-138": ("009-138", "anna - true-hearted", "special_printing"),
    "LOR9-137": (None, None, "ambiguous"),
    # This is the historical bug: Huey was incorrectly attached to Anna.
    "LOR9-138": ("009-138", "anna - true-hearted", "matched_name_mismatch"),
    "DLPC1-10-C2": (None, None, "unmatched"),
    "DLPC1-2-C1": ("001-163", "let it go", "special"),
    "LOR1-163": ("001-163", "let it go", "matched"),
    "LOR11-163": ("001-163", "let it go", "special_printing"),
    "Q1-223": (None, None, "unmatched"),
}

payload_cards = []
for card in mapped:
    normal, foil = prices[card["id"]]
    canonical_id, card_db_key, legacy_status = legacy[card["id"]]
    payload_cards.append({
        **card,
        "canonical_id": canonical_id,
        "card_db_key": card_db_key,
        "match_status": legacy_status,
        "match_note": None,
        "printing_type": "regular",
        "printing_label": "Regular",
        "rarity": "R",
        "normal": {"low": normal, "average": normal, "high": normal},
        "foil": (
            {"low": foil, "average": foil, "high": foil}
            if foil is not None
            else None
        ),
        "minimum_price_brl": normal,
        "status": "ok",
        "checked_at": "2026-07-23T00:00:00+00:00",
        "url": f"https://www.ligalorcana.com.br/?id={card['id']}",
    })

price_map = agent.build_price_map({
    "generated_at": "2026-07-23T00:00:00+00:00",
    "cards": payload_cards,
})
exact = price_map["prices_by_liga_id"]

assert_true(price_map["schema_version"] == 4, "Price map is not schema v4")
assert_true(len(exact) == len(payload_cards), "An exact Liga printing was dropped")
assert_true(exact["LOR4-138"]["normal"]["low"] == 3.49, "Anna set 4 price is wrong")
assert_true(exact["LOR9-137"]["normal"]["low"] == 2.25, "Anna set 9 price is wrong")
assert_true(exact["LOR9-138"]["name"] == "Huey - Savvy Nephew", "Huey identity was changed")
assert_true(exact["DLPC1-10-C2"]["normal"]["low"] == 125.00, "Challenge Let It Go price is wrong")
assert_true(exact["DLPC1-2-C1"]["normal"]["low"] == 2999.90, "C1 Let It Go price is wrong")
assert_true(exact["LOR1-163"]["normal"]["low"] == 19.90, "Set 1 Let It Go price is wrong")
assert_true(exact["LOR11-163"]["normal"]["low"] == 12.99, "Set 11 Let It Go price is wrong")
assert_true(exact["LOR4-138"]["foil"]["low"] == 5.99, "Normal/foil prices were merged")

legacy_anna = price_map["prices"]["009-138"]["printings"]
assert_true(
    [printing["liga_id"] for printing in legacy_anna] == ["LOR4-138"],
    "Huey contaminated Anna's legacy compatibility group",
)

print(
    "PASS: price agent preserves exact Anna/Let It Go printings, "
    "normal/foil prices, and rejects the Huey→Anna legacy mismatch"
)
