"""Opt-in saves at profile quotas, including disk, encoding and loop delay.

Run: python -B tests/benchmark_profiles.py --rounds 5
Uses real profile transactions and ConfirmedStore with an atomic stdlib JSON
disk double for HA Store. Does not measure HA's serializer or network/browser I/O.
"""

import argparse
import asyncio
from copy import deepcopy
import json
import os
from pathlib import Path
from statistics import median
import sys
import tempfile
from time import perf_counter
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_profiles import Connection, ProfileTests, fixtures, profile, profiles

WARMUP_ROUNDS = 1
HEARTBEAT_SECONDS = 0.001


def document(profile_count: int, links: int, target_bytes: int | None = None) -> dict:
    """Generate valid fixtures, optionally filling a byte quota exactly."""
    items = []
    for index in range(profile_count):
        item = profile(f"profile_{index}")
        item["favorites"] = ["sensor.item_0"]
        template = item["settings"]["links"][0]
        item["settings"]["links"] = [
            {**template, "id": f"link_{link}"} for link in range(links)
        ]
        items.append(item)
    result = {"version": 1, "revision": 100, "profiles": items}
    if target_bytes is not None:
        remaining = target_bytes - profiles.encoded_size(result)
        if remaining < 0:
            raise ValueError("Fixture exceeds requested quota before padding")
        profile_padding, remainder = divmod(remaining, profile_count)
        for item in items:
            padding, link_remainder = divmod(profile_padding + (remainder > 0), links)
            remainder = max(0, remainder - 1)
            for link in item["settings"]["links"]:
                link["path"] += "x" * (padding + (link_remainder > 0))
                link_remainder = max(0, link_remainder - 1)
        assert profiles.encoded_size(result) == target_bytes
    return result


def write_disk(store, data) -> None:
    """Model HA's private atomic persistence with a real file and fsync."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=Path(store.path).parent,
                                         delete=False) as stream:
            temporary = Path(stream.name)
            json.dump({"version": profiles.SCHEMA_VERSION, "data": data}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, store.path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


async def save_disk(store, data) -> None:
    await store.hass.async_add_executor_job(write_disk, store, data)


async def heartbeat(stop: asyncio.Event, gaps: list[float]) -> None:
    """Observe scheduling gaps while the transaction's workers are busy."""
    previous = perf_counter()
    while not stop.is_set():
        await asyncio.sleep(HEARTBEAT_SECONDS)
        now = perf_counter()
        gaps.append((now - previous) * 1000)
        previous = now


async def measure(name: str, count: int, links: int, subscribers: int, rounds: int,
                  target_mib: int | None = None) -> dict:
    fixture = ProfileTests()
    fixture.setUp()
    await fixture.asyncSetUp()
    # Only HA APIs are doubled. Executor jobs use real threads, disk preflight
    # and read-back use the real implementation, and sends retain encoded bytes.
    fixture.hass.async_add_executor_job = asyncio.to_thread
    default_mib = fixtures.constants.DEFAULT_OPTIONS["max_user_mib"]
    fixture.entry.options = dict(fixtures.constants.OPTION_MAXIMUMS if target_mib and target_mib > default_mib
                                 else fixtures.constants.DEFAULT_OPTIONS)
    user = fixture.manager.user("alice")
    user.data = document(count, links, target_mib * profiles.MIB if target_mib else None)
    if target_mib is None or target_mib <= fixtures.constants.OPTION_MAXIMUMS["max_user_mib"]:
        profiles.enforce_quotas({"version": 1, "revision": 0, "profiles": []}, user.data, fixture.manager.limits)
    clients = [Connection() for _ in range(subscribers)]
    samples, delays = [], []
    counts = {"document_copies": 0, "profile_copies": 0, "snapshots": 0, "size_encodes": 0}
    original_snapshot = fixture.manager.snapshot
    original_size = profiles.encoded_size

    def copy(value):
        if isinstance(value, dict):
            if isinstance(value.get("profiles"), list):
                counts["document_copies"] += 1
            elif "settings" in value:
                counts["profile_copies"] += 1
        return deepcopy(value)

    def snapshot(*args, **kwargs):
        counts["snapshots"] += 1
        return original_snapshot(*args, **kwargs)

    def size(value):
        counts["size_encodes"] += 1
        return original_size(value)

    with tempfile.TemporaryDirectory() as directory:
        user.store.path = str(Path(directory) / "profiles.json")
        for index, client in enumerate(clients):
            # Browser JSON decoding is deliberately outside the measured server.
            client.send_message.side_effect = None
            await fixture.subscribe(client, index + 1)
        with patch.object(fixtures.MemoryStore, "async_save", new=save_disk), \
                patch.object(profiles, "deepcopy", copy), \
                patch.object(profiles, "encoded_size", size), \
                patch.object(fixture.manager, "snapshot", snapshot):
            for iteration in range(rounds + WARMUP_ROUNDS):
                for client in clients:
                    client.send_message.reset_mock()
                for key in counts:
                    counts[key] = 0
                changed = deepcopy(user.data["profiles"][0])
                changed["favorites"] = [f"sensor.item_{iteration % 2}"]
                stop, gaps = asyncio.Event(), []
                monitor = asyncio.create_task(heartbeat(stop, gaps))
                await asyncio.sleep(0)
                start = perf_counter()
                try:
                    async with user.lock:
                        result = await fixture.manager.mutate(user, {
                            "operation": "update", "profile_id": changed["id"],
                            "revision": user.data["revision"], "profile": changed,
                        })
                    response = await asyncio.to_thread(profiles.construct_result_message, 12, result)
                    elapsed = (perf_counter() - start) * 1000
                finally:
                    stop.set()
                    await monitor
                if iteration >= WARMUP_ROUNDS:
                    samples.append(elapsed)
                    delays.append(max(gaps, default=0))
        assert profiles._read_storage(user.store.path)["data"] == user.data
    decoded = json.loads(response)["result"]
    assert all(json.loads(client.send_message.call_args.args[0])["event"] == decoded for client in clients)
    return {"case": name, "subscribers": subscribers, **counts,
            "median_save_ms": round(median(samples), 3),
            "max_loop_gap_ms": round(max(delays), 3),
            "document_bytes": profiles.encoded_size(user.data), "payload_bytes": len(result)}


async def main(rounds: int) -> None:
    default_mib = fixtures.constants.DEFAULT_OPTIONS["max_user_mib"]
    maximum_mib = fixtures.constants.OPTION_MAXIMUMS["max_user_mib"]
    cases = [
        ("small", 1, 5, 1, None),
        ("large_fanout", 4, profiles.MAX_SHORTCUTS, 5, None),
        ("default_quota", 4, 1, 1, default_mib),
        ("maximum_quota", 4, 1, 5, maximum_mib),
        ("maximum_quota_items", 4, profiles.MAX_SHORTCUTS, 5, maximum_mib),
    ]
    for name, count, links, subscribers, target_mib in cases:
        print(json.dumps(await measure(name, count, links, subscribers, rounds, target_mib)), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rounds", type=int, default=5)
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error("--rounds must be positive")
    asyncio.run(main(args.rounds))
