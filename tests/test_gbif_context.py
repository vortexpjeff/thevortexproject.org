import json
import pathlib
import sys
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))

from gbif_context import enrich_top_species, normalize_match, normalize_month_facets


MATCH = {
    "usageKey": 2493801,
    "scientificName": "Thryothorus ludovicianus (Latham, 1790)",
    "canonicalName": "Thryothorus ludovicianus",
    "rank": "SPECIES",
    "status": "ACCEPTED",
    "confidence": 99,
    "matchType": "EXACT",
    "order": "Passeriformes",
    "family": "Troglodytidae",
}

FACETS = {
    "count": 476045,
    "facets": [{
        "field": "MONTH",
        "counts": [
            {"name": "4", "count": 60808},
            {"name": "1", "count": 37746},
            {"name": "12", "count": 35745},
        ],
    }],
}


class GbifContextTest(unittest.TestCase):
    def test_normalize_match_requires_exact_accepted_species(self):
        result = normalize_match(MATCH, "Thryothorus ludovicianus")
        self.assertEqual(result, {
            "key": 2493801,
            "accepted_scientific_name": "Thryothorus ludovicianus (Latham, 1790)",
            "canonical_name": "Thryothorus ludovicianus",
            "family": "Troglodytidae",
            "order": "Passeriformes",
            "url": "https://www.gbif.org/species/2493801",
        })
        fuzzy = dict(MATCH, matchType="FUZZY", confidence=98)
        self.assertIsNone(normalize_match(fuzzy, "Thryothorus ludovicianus"))

    def test_normalize_month_facets_returns_explicit_twelve_month_shape(self):
        result = normalize_month_facets(FACETS)
        self.assertEqual(result["total_records"], 476045)
        self.assertEqual(len(result["months"]), 12)
        self.assertEqual(result["months"][0], 37746)
        self.assertEqual(result["months"][3], 60808)
        self.assertEqual(result["months"][11], 35745)
        self.assertEqual(result["months"][6], 0)

    def test_enrichment_uses_broad_query_and_persists_cache(self):
        requested_urls = []

        def fake_fetch(url):
            requested_urls.append(url)
            return MATCH if "/species/match" in url else FACETS

        rows = [{
            "name": "Carolina Wren",
            "scientific_name": "Thryothorus ludovicianus",
            "count": 53,
        }]
        with tempfile.TemporaryDirectory() as directory:
            cache_path = pathlib.Path(directory) / "gbif.json"
            enriched = enrich_top_species(rows, cache_path, fake_fetch, now=1_700_000_000)
            self.assertEqual(enriched[0]["gbif"]["taxonomy"]["family"], "Troglodytidae")
            self.assertEqual(enriched[0]["gbif"]["seasonal"]["scope"], "Tennessee, United States")
            self.assertEqual(enriched[0]["gbif"]["seasonal"]["months"][3], 60808)
            self.assertTrue(cache_path.exists())

        occurrence_url = next(url for url in requested_urls if "/occurrence/search" in url)
        params = parse_qs(urlparse(occurrence_url).query)
        self.assertEqual(params["taxon_key"], ["2493801"])
        self.assertEqual(params["country"], ["US"])
        self.assertEqual(params["state_province"], ["Tennessee"])
        self.assertEqual(params["facetLimit"], ["12"])
        self.assertNotIn("decimalLatitude", params)
        self.assertNotIn("decimalLongitude", params)
        self.assertNotIn("geometry", params)

    def test_fresh_cache_avoids_network_and_stale_cache_survives_outage(self):
        context = {
            "taxonomy": normalize_match(MATCH, "Thryothorus ludovicianus"),
            "seasonal": {
                "scope": "Tennessee, United States",
                **normalize_month_facets(FACETS),
            },
        }
        rows = [{
            "name": "Carolina Wren",
            "scientific_name": "Thryothorus ludovicianus",
            "count": 8,
        }]
        with tempfile.TemporaryDirectory() as directory:
            cache_path = pathlib.Path(directory) / "gbif.json"
            cache_path.write_text(json.dumps({
                "species": {
                    "Thryothorus ludovicianus": {
                        "cached_at": 1_700_000_000,
                        "context": context,
                    }
                }
            }))

            def should_not_fetch(_url):
                raise AssertionError("fresh cache should avoid GBIF")

            fresh = enrich_top_species(rows, cache_path, should_not_fetch, now=1_700_000_100)
            self.assertEqual(fresh[0]["gbif"], context)

            def unavailable(_url):
                raise OSError("provider unavailable")

            stale = enrich_top_species(rows, cache_path, unavailable, now=1_800_000_000)
            self.assertEqual(stale[0]["gbif"], context)

            for failed_occurrence in (None, {}):
                calls = 0

                def partial_outage(_url):
                    nonlocal calls
                    calls += 1
                    return MATCH if calls == 1 else failed_occurrence

                partial = enrich_top_species(rows, cache_path, partial_outage, now=1_800_000_100)
                self.assertEqual(partial[0]["gbif"], context)
                persisted = json.loads(cache_path.read_text())
                entry = persisted["species"]["Thryothorus ludovicianus"]
                self.assertEqual(entry["cached_at"], 1_700_000_000)
                self.assertEqual(entry["context"], context)


if __name__ == "__main__":
    unittest.main(verbosity=2)
