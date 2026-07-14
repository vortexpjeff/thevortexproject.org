"""Cached, broad-geography GBIF context for BirdNET species.

This module never queries with station coordinates. Occurrence context is restricted to
Tennessee, United States and describes GBIF occurrence records, not abundance or proof
of a local sighting.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import urlencode

GBIF_API = "https://api.gbif.org/v1"
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
SCOPE = "Tennessee, United States"


def normalize_match(payload, requested_name):
    """Return conservative accepted species metadata for an exact GBIF match."""
    if not isinstance(payload, dict):
        return None
    if payload.get("matchType") != "EXACT" or payload.get("status") != "ACCEPTED":
        return None
    if payload.get("rank") != "SPECIES":
        return None
    key = payload.get("usageKey")
    try:
        key = int(key)
    except (TypeError, ValueError):
        return None
    if key <= 0:
        return None
    canonical = str(payload.get("canonicalName") or "").strip()
    scientific = str(payload.get("scientificName") or "").strip()
    if not canonical or not scientific:
        return None
    return {
        "key": key,
        "accepted_scientific_name": scientific,
        "canonical_name": canonical,
        "family": str(payload.get("family") or "").strip() or None,
        "order": str(payload.get("order") or "").strip() or None,
        "url": f"https://www.gbif.org/species/{key}",
    }


def normalize_month_facets(payload):
    """Normalize GBIF month facets into a fixed January-through-December array."""
    months = [0] * 12
    if not isinstance(payload, dict):
        return {"total_records": 0, "months": months}
    for facet in payload.get("facets") or []:
        if not isinstance(facet, dict) or str(facet.get("field", "")).upper() != "MONTH":
            continue
        for item in facet.get("counts") or []:
            if not isinstance(item, dict):
                continue
            try:
                month = int(item.get("name"))
                count = max(0, int(item.get("count")))
            except (TypeError, ValueError):
                continue
            if 1 <= month <= 12:
                months[month - 1] = count
        break
    try:
        total = max(0, int(payload.get("count", 0)))
    except (TypeError, ValueError):
        total = 0
    return {"total_records": total, "months": months}


def _load_cache(path):
    try:
        payload = json.loads(Path(path).read_text())
    except (OSError, ValueError, TypeError):
        return {"species": {}}
    if not isinstance(payload, dict) or not isinstance(payload.get("species"), dict):
        return {"species": {}}
    return payload


def _save_cache(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def _is_fresh(entry, now, ttl_seconds):
    if not isinstance(entry, dict) or not isinstance(entry.get("context"), dict):
        return False
    try:
        age = float(now) - float(entry.get("cached_at"))
    except (TypeError, ValueError):
        return False
    return 0 <= age < ttl_seconds


def _fetch_context(scientific_name, fetch_json):
    match_url = f"{GBIF_API}/species/match?{urlencode({'name': scientific_name})}"
    match = normalize_match(fetch_json(match_url), scientific_name)
    if not match:
        return None
    occurrence_params = {
        "taxon_key": match["key"],
        "country": "US",
        "state_province": "Tennessee",
        "limit": 0,
        "facet": "month",
        "facetLimit": 12,
    }
    occurrence_url = f"{GBIF_API}/occurrence/search?{urlencode(occurrence_params)}"
    occurrence = fetch_json(occurrence_url)
    if not isinstance(occurrence, dict) or not isinstance(occurrence.get("facets"), list):
        return None
    try:
        occurrence_count = int(occurrence["count"])
    except (KeyError, TypeError, ValueError):
        return None
    if occurrence_count < 0:
        return None
    seasonal = normalize_month_facets(occurrence)
    seasonal["scope"] = SCOPE
    return {"taxonomy": match, "seasonal": seasonal}


def enrich_top_species(rows, cache_path, fetch_json, now=None, ttl_seconds=CACHE_TTL_SECONDS):
    """Attach cached GBIF context to rows while preserving BirdNET measurements.

    Failed refreshes retain stale cached context. Species without an exact accepted
    taxonomy match remain valid BirdNET rows and are returned without a ``gbif`` key.
    """
    now = time.time() if now is None else float(now)
    cache = _load_cache(cache_path)
    species_cache = cache.setdefault("species", {})
    enriched = []
    cache_changed = False

    for row in rows or []:
        if not isinstance(row, dict):
            continue
        output = dict(row)
        scientific_name = str(row.get("scientific_name") or "").strip()
        entry = species_cache.get(scientific_name) if scientific_name else None
        context = entry.get("context") if isinstance(entry, dict) else None

        if scientific_name and not _is_fresh(entry, now, ttl_seconds):
            try:
                refreshed = _fetch_context(scientific_name, fetch_json)
            except Exception:
                refreshed = None
            if refreshed:
                context = refreshed
                species_cache[scientific_name] = {
                    "cached_at": now,
                    "context": refreshed,
                }
                cache_changed = True

        if isinstance(context, dict):
            output["gbif"] = context
        enriched.append(output)

    if cache_changed:
        cache["updated_at"] = now
        _save_cache(cache_path, cache)
    return enriched
