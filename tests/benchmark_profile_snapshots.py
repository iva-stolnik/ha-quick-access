"""Serve an opt-in browser benchmark using the server benchmark's fixtures.

Run: python -B tests/benchmark_profile_snapshots.py
For a phone on the same LAN, add --host 0.0.0.0 and open the printed port
using this computer's LAN address. Only synthetic data and frontend assets
are served; this does not connect to Home Assistant.
"""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlsplit

from benchmark_profiles import document, fixtures, profiles

FRONTEND = Path(__file__).resolve().parents[1] / "frontend/src"
PAGE = Path(__file__).with_suffix(".html")


def snapshots() -> tuple[list[dict], dict[str, bytes]]:
    """Validate fixtures and encode actual event/result snapshot envelopes."""
    cases = [
        ("small", 1, 5, None),
        ("representative", 4, 100, None),
        ("large_collection", 4, profiles.MAX_SHORTCUTS, None),
        ("default_quota_items", 4, profiles.MAX_SHORTCUTS, fixtures.constants.DEFAULT_OPTIONS),
        ("maximum_quota_items", 4, profiles.MAX_SHORTCUTS, fixtures.constants.OPTION_MAXIMUMS),
        ("maximum_quota_strings", 4, 1, fixtures.constants.OPTION_MAXIMUMS),
    ]
    manager = profiles.ProfileStore(None, "snapshot-benchmark")
    metadata, payloads = [], {}
    for name, count, links, options in cases:
        limits = profiles.ResourceLimits.from_options(options or fixtures.constants.DEFAULT_OPTIONS)
        data = document(count, links, limits.max_user_bytes if options else None)
        if options is None:
            # Ordinary fixtures contain rooms, distinct names/paths, both URL
            # types and favorites, rather than just repeated padded strings.
            for item in data["profiles"]:
                item["categories"] += [{"id": f"room_{i}", "name": f"Room {i}"} for i in range(8)]
                item["favorites"] = [f"sensor.room_{i}" for i in range(100)]
                for index, link in enumerate(item["settings"]["links"]):
                    external = index % 3 == 0
                    link.update(
                        name=f"Room {index % 8} shortcut {index}",
                        group=f"room_{index % 8}",
                        type="external" if external else "internal",
                        path=f"https://example.com/room/{index}" if external else f"/lovelace/room-{index}",
                    )
        data = profiles.validate_document(data)
        usage = profiles.enforce_quotas({"version": 1, "revision": 0, "profiles": []}, data, limits)
        payload = profiles.json_bytes(manager.snapshot(data, usage, limits))
        event = profiles.construct_event_message(1, payload)
        result = profiles.construct_result_message(2, payload)
        payloads[f"/snapshots/{name}/event"] = event
        payloads[f"/snapshots/{name}/result"] = result
        metadata.append({"name": name, "profiles": count, "shortcuts": count * links,
                         "storage_bytes": usage["user_bytes"], "event_bytes": len(event),
                         "result_bytes": len(result)})
    return metadata, payloads


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    metadata, payloads = snapshots()
    assets = {f"/quick_access/{path.relative_to(FRONTEND).as_posix()}": path
              for path in FRONTEND.rglob("*.js")}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            route = urlsplit(self.path).path
            if route == "/":
                body, mime = PAGE.read_bytes(), "text/html"
            elif route == "/cases":
                body, mime = json.dumps(metadata).encode("utf-8"), "application/json"
            elif route in payloads:
                body, mime = payloads[route], "application/json"
            elif route in assets:
                body, mime = assets[route].read_bytes(), "text/javascript"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", f"{mime}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    with ThreadingHTTPServer((args.host, args.port), Handler) as server:
        print(f"Snapshot benchmark: http://{args.host}:{server.server_port}/ (Ctrl+C to stop)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
