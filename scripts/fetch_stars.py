"""Fetch GitHub star data for projects and write _data/gh_stars.yml.

Reads _data/projects.yml. For each entry:
  - `repo: owner/name` -> fetches that repo's stargazers_count
  - `org: orgname`     -> lists all public, non-fork, non-archived repos
                          in the org, with stars, url, description

Output schema (_data/gh_stars.yml):
  generated_at: "2026-05-27T04:00:00Z"
  repos:
    owner/name: 1234
  orgs:
    OpenMOSS:
      - name: MOSS
        stars: 1000
        url: https://github.com/OpenMOSS/MOSS
        desc: ...

Run on CI with GITHUB_TOKEN in env for the higher rate limit; works
unauthenticated locally too (60 req/hour per IP).
"""
from __future__ import annotations

import datetime
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

API = "https://api.github.com"
TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
ROOT = Path(__file__).resolve().parent.parent


def gh(path: str):
    req = urllib.request.Request(
        API + path,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "homepages2024-stars-fetcher",
        },
    )
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def list_org_repos(org: str) -> list[dict]:
    repos: list[dict] = []
    for page in range(1, 11):  # up to 1000 repos
        batch = gh(f"/orgs/{org}/repos?per_page=100&type=public&page={page}")
        if not batch:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break

    out = []
    for r in repos:
        if r.get("fork") or r.get("archived") or r.get("private"):
            continue
        out.append(
            {
                "name": r["name"],
                "stars": r.get("stargazers_count") or 0,
                "url": r["html_url"],
                "desc": r.get("description") or "",
            }
        )
    out.sort(key=lambda x: x["stars"], reverse=True)
    return out


def main() -> int:
    projects_path = ROOT / "_data" / "projects.yml"
    projects = yaml.safe_load(projects_path.read_text(encoding="utf-8")) or []

    repos: dict[str, int] = {}
    orgs: dict[str, list[dict]] = {}
    errors = 0

    for p in projects:
        repo = p.get("repo")
        org = p.get("org")
        if repo:
            try:
                data = gh(f"/repos/{repo}")
                repos[repo] = data.get("stargazers_count") or 0
                print(f"repo {repo}: {repos[repo]} stars")
            except Exception as e:
                errors += 1
                print(f"!! repo {repo}: {e}", file=sys.stderr)
        if org:
            try:
                orgs[org] = list_org_repos(org)
                print(f"org  {org}: {len(orgs[org])} public repos")
            except Exception as e:
                errors += 1
                print(f"!! org {org}: {e}", file=sys.stderr)

    payload = {
        "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "repos": repos,
        "orgs": orgs,
    }
    out_path = ROOT / "_data" / "gh_stars.yml"
    out_path.write_text(
        yaml.safe_dump(payload, allow_unicode=True, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )
    print(f"wrote {out_path}")

    # Non-fatal: a single missing repo shouldn't fail the build, but surface it.
    return 0 if errors == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
