"""Reviewer-package structure checks; these do not certify runtime readiness."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlsplit

import pytest

ROOT = Path(__file__).resolve().parent.parent
DOCS = {
    "impact-case.md", "compliance-note.md", "architecture.md", "dependencies.md",
}
INTERNAL = {
    "code.md", "agents.md", "claude.md", "context", "agents", "skills",
    ".agents", ".cptr", ".claude", ".vscode",
}


def test_only_required_reviewer_docs_are_present():
    assert {p.name for p in (ROOT / "docs").iterdir()} == DOCS
    assert all((ROOT / "docs" / name).is_file() for name in DOCS)


def test_application_is_under_src_without_duplicate_old_tree():
    for name in ("lobby.html", "index.html", "player.html", "sandbox.html",
                 "src/warmer.js", "src/governor.js", "styles/player.css"):
        assert (ROOT / "src" / name).is_file(), name
    assert not (ROOT / "prototype").exists()


def test_internal_instructions_and_skills_are_not_in_submission_root():
    assert not {p.name.lower() for p in ROOT.iterdir()} & INTERNAL


def test_packaging_commands_reference_the_new_source_root():
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    assert scripts["test"] == "node --test src/tests/*.test.mjs"
    assert "find src " in scripts["check:js"]
    assert "--directory src" in scripts["serve:python"]
    assert "--directory src" in (ROOT / "scripts/serve.sh").read_text()
    assert "'..', 'src'" in (ROOT / "scripts/serve-node.mjs").read_text()
    assert 'root / "src"' in (ROOT / "tools/sandbox_server.py").read_text()


def test_local_reviewer_document_links_resolve_without_private_material():
    documents = [ROOT / "README.md", *sorted((ROOT / "docs").glob("*.md"))]
    for document in documents:
        for target in re.findall(r"\[[^\]]*\]\(([^\s)]+)\)", document.read_text()):
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            path = (document.parent / unquote(parsed.path)).resolve()
            assert path.is_relative_to(ROOT), (document.name, target)
            relative = path.relative_to(ROOT)
            assert not any(part.lower() in INTERNAL or part == ".submission-staging"
                           for part in relative.parts), (document.name, target)
            assert path.exists(), (document.name, target)


@pytest.mark.skipif(not shutil.which("git") or not (ROOT / ".git").exists(),
                    reason="ignore-rule check requires a Git checkout")
def test_private_stage_and_agent_material_are_ignored():
    paths = [".submission-staging/notes.md", ".cptr/skills/test/SKILL.md",
             "AGENTS.md", "CODE.md", "agents/test.md", "docs/internal-notes.md"]
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "--stdin"], input="\n".join(paths) + "\n",
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert set(result.stdout.splitlines()) == set(paths)
    for name in DOCS:
        result = subprocess.run(
            ["git", "check-ignore", "--no-index", f"docs/{name}"], cwd=ROOT,
            capture_output=True, text=True, check=False,
        )
        assert result.returncode == 1, name


def test_sandbox_serves_relocated_lobby_and_module_bytes():
    # Local HTTP smoke check only: no browser execution, game assets or production calls.
    sys.path.insert(0, str(ROOT / "tools"))
    from sandbox_server import serve

    server = serve(ROOT / "src", port=0, throttle_kbps=0)
    try:
        origin = f"http://127.0.0.1:{server.server_address[1]}"
        for path in ("/lobby.html", "/src/warmer.js", "/styles/player.css"):
            with urllib.request.urlopen(origin + path, timeout=5) as response:
                assert response.status == 200
                assert response.read() == (ROOT / "src" / path.lstrip("/")).read_bytes()
        for path in ("/AGENTS.md", "/CODE.md", "/.submission-staging/notes.md"):
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(origin + path, timeout=5)
            with error.value as response:
                assert response.code == 404
    finally:
        server.shutdown()
        server.server_close()
