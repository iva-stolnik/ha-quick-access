#!/usr/bin/env python3
"""Add real GitHub repository/maintainer metadata required for HACS publication.

Usage: python scripts/configure_repository.py OWNER/ha-quick-access @MAINTAINER
       python scripts/configure_repository.py --check
"""

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

MANIFEST = Path(__file__).resolve().parents[1] / "custom_components/quick_access/manifest.json"
REPOSITORY = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*\Z")
MAINTAINER = re.compile(r"@[A-Za-z0-9][A-Za-z0-9-]*\Z")


def _is_https_url(value):
    if not isinstance(value, str):
        return False
    url = urlsplit(value)
    return url.scheme == "https" and bool(url.hostname) and not url.username and not url.password


def check(manifest):
    failures = []
    for key in ("documentation", "issue_tracker"):
        if not _is_https_url(manifest.get(key)):
            failures.append(f"manifest.json: {key} must be a real HTTPS URL")
    owners = manifest.get("codeowners")
    if not isinstance(owners, list) or not owners or not all(isinstance(x, str) and MAINTAINER.fullmatch(x) for x in owners):
        failures.append("manifest.json: codeowners must include an actual GitHub @username")
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", nargs="?", help="Actual GitHub OWNER/REPO (not a URL)")
    parser.add_argument("maintainer", nargs="?", help="Actual GitHub @username responsible for the integration")
    parser.add_argument("--check", action="store_true", help="Verify release metadata without modifying files")
    args = parser.parse_args()
    if not args.check and not (args.repository and args.maintainer):
        parser.error("provide OWNER/REPO and @MAINTAINER, or use --check")
    if args.check and (args.repository or args.maintainer):
        parser.error("--check cannot be combined with repository/maintainer arguments")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if not args.check:
        if not REPOSITORY.fullmatch(args.repository) or args.repository.endswith("."):
            parser.error("repository must be an actual GitHub OWNER/REPO")
        if not MAINTAINER.fullmatch(args.maintainer):
            parser.error("maintainer must be an actual GitHub @username")
        manifest["documentation"] = f"https://github.com/{args.repository}"
        manifest["issue_tracker"] = f"https://github.com/{args.repository}/issues"
        manifest["codeowners"] = [args.maintainer]
        # Home Assistant's manifest ordering: domain, name, then other keys alphabetically.
        ordered = {key: manifest[key] for key in ("domain", "name")}
        ordered.update((key, value) for key, value in sorted(manifest.items()) if key not in ordered)
        MANIFEST.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    errors = check(manifest)
    if errors:
        parser.exit(1, "\n".join(errors) + "\nFill your real repository details with: "
                    "python scripts/configure_repository.py OWNER/ha-quick-access @MAINTAINER\n")
    print("HACS release metadata: valid format (verify URLs exist before publishing).")


if __name__ == "__main__":
    main()
