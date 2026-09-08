"""Synthetic-only tests for the reviewed Empire CDN preparation command."""

from __future__ import annotations

import hashlib
import json
import stat
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import pytest

from tools import prepare_empire_cdn as module


@pytest.fixture
def synthetic(tmp_path, monkeypatch):
    prototype = tmp_path / "prototype"
    wrappers = {
        "empire-player.html": b"<!doctype html><title>synthetic wrapper</title>\n",
        "src/empire-player.js": b"export const syntheticWrapper = true;\n",
    }
    for relative, payload in wrappers.items():
        target = prototype / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)

    entries = {
        "index.html": b"<!doctype html><script src='assets/bootstrap.js'></script>\r\n",
        "assets/bootstrap.js": b"const providerByte = '\x00\xff';\n",
        "assets/late/texture.bin": bytes(range(256)),
    }
    for index, (_, relative) in enumerate(module.EARLY_ASSETS):
        entries[relative] = bytes((index, 0, 255, 13, 10)) * (index + 1)

    archive_path = tmp_path / "synthetic-reviewed.zip"
    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
        for relative, payload in entries.items():
            archive.writestr(module.ARCHIVE_PREFIX + relative, payload)
        archive.writestr(module.ARCHIVE_PREFIX + "private-not-deployed.txt", b"private")
        archive.writestr("operator/private-note.txt", b"not part of public output")
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    monkeypatch.setattr(module, "REVIEWED_ARCHIVE_SHA256", digest)
    monkeypatch.setattr(module, "PROTOTYPE_ROOT", prototype)
    return archive_path, entries, wrappers, digest


def prepare(synthetic, output, **overrides):
    archive, _, _, _ = synthetic
    arguments = {
        "zip_path": archive,
        "cdn_origin": "https://cdn.example.test",
        "lobby_origin": "http://127.0.0.1:8100",
        "output_dir": output,
    }
    arguments.update(overrides)
    return module.prepare(**arguments)


def test_prepares_unchanged_provider_tree_wrappers_headers_config_and_manifest(synthetic, tmp_path):
    archive, entries, wrappers, digest = synthetic
    archive_before = archive.read_bytes()
    output = tmp_path / "public"

    returned = prepare(synthetic, output)

    assert archive.read_bytes() == archive_before
    release_root = output / "releases" / digest
    for relative, payload in entries.items():
        assert (release_root / relative).read_bytes() == payload
    assert not (release_root / "private-not-deployed.txt").exists()
    assert not (output / "operator").exists()
    for prototype_name, payload in wrappers.items():
        deployed = "__vault/player.html" if prototype_name.endswith(".html") else "__vault/player.js"
        assert (output / deployed).read_bytes() == payload

    config = json.loads((output / "__vault/config.json").read_text())
    build = f"empire-{digest[:16]}"
    assert {key: config[key] for key in ("delivery", "build", "archiveSha256")} == {
        "delivery": "CDN",
        "build": build,
        "archiveSha256": digest,
    }
    assert config["lobbyOrigin"] == "http://127.0.0.1:8100"
    assert len(config["entries"]) == 1
    entry = config["entries"][0]
    assert entry["id"] == "title-01"
    assert entry["delivery"] == "CDN"
    assert entry["origin"] == "https://cdn.example.test"
    assert entry["wrapperUrl"] == "https://cdn.example.test/__vault/player.html"
    release_base = f"https://cdn.example.test/releases/{digest}/"
    assert entry["launchUrl"] == f"{release_base}index.html?language=en"
    assert entry["assetBaseUrl"] == release_base
    assert entry["assets"] == [
        {
            "estimatedBytes": len(entries[relative]),
            "releaseBuild": build,
            "sha256": hashlib.sha256(entries[relative]).hexdigest(),
            "stage": stage,
            "url": f"{release_base}{relative}",
        }
        for stage, relative in module.EARLY_ASSETS
    ]

    headers = (output / "_headers").read_text()
    assert (
        f"/releases/{digest}/assets/*\n"
        "  Cache-Control: public, max-age=31536000, immutable"
    ) in headers
    assert "Access-Control-Allow-Origin: http://127.0.0.1:8100" in headers
    assert "Timing-Allow-Origin: http://127.0.0.1:8100" in headers
    assert "/__vault/*\n  Cache-Control: no-store" in headers

    persisted = json.loads((output / "deployment-manifest.json").read_text())
    assert persisted == returned
    assert persisted["providerBytesModified"] is False
    assert persisted["archiveSha256"] == digest
    records = {record["path"]: record for record in persisted["providerFiles"]}
    expected_paths = {f"releases/{digest}/{relative}" for relative in entries}
    assert set(records) == expected_paths
    for relative, payload in entries.items():
        record = records[f"releases/{digest}/{relative}"]
        assert record["bytes"] == len(payload)
        assert record["sha256"] == hashlib.sha256(payload).hexdigest()
    serialized = json.dumps(persisted)
    assert str(archive) not in serialized
    assert "operator/private-note.txt" not in serialized
    assert "private-not-deployed.txt" not in serialized


def test_script_help_runs_from_repository_root_without_provider_archive():
    result = subprocess.run(
        [sys.executable, "tools/prepare_empire_cdn.py", "--help"],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "--cdn-origin" in result.stdout
    assert result.stderr == ""


def test_main_uses_default_lobby_and_prints_only_fixed_public_outputs(synthetic, tmp_path, capsys):
    archive, _, _, _ = synthetic
    output = tmp_path / "site"
    assert module.main(
        ["--zip", str(archive), "--cdn-origin", "https://cdn.example.test", "--output-dir", str(output)]
    ) == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed == {"status": "prepared", "outputs": list(module.PUBLIC_OUTPUTS)}
    assert str(archive) not in json.dumps(printed)
    assert str(output) not in json.dumps(printed)
    config = json.loads((output / "__vault/config.json").read_text())
    assert config["lobbyOrigin"] == "http://127.0.0.1:8100"


@pytest.mark.parametrize(
    "origin",
    [
        "http://cdn.example.test",
        "https://cdn.example.test/",
        "https://cdn.example.test/path",
        "https://cdn.example.test?query=1",
        "https://cdn.example.test#fragment",
        "https://user@cdn.example.test",
        "https://cdn.example.test:99999",
        "https://cdn.example.test\\evil",
        " https://cdn.example.test",
        "",
    ],
)
def test_rejects_non_exact_https_cdn_origins_without_output(synthetic, tmp_path, origin):
    output = tmp_path / "site"
    with pytest.raises(module.PreparationError, match="exact origin"):
        prepare(synthetic, output, cdn_origin=origin)
    assert not output.exists()


@pytest.mark.parametrize(
    "origin",
    [
        "ftp://lobby.example.test",
        "http://lobby.example.test/",
        "http://user@lobby.example.test",
        "http://lobby.example.test\r\nInjected: yes",
    ],
)
def test_rejects_unsafe_lobby_origins_without_output(synthetic, tmp_path, origin):
    output = tmp_path / "site"
    with pytest.raises(module.PreparationError, match="exact origin"):
        prepare(synthetic, output, lobby_origin=origin)
    assert not output.exists()


def test_rejects_sha_mismatch_and_does_not_disclose_input_path(synthetic, tmp_path, monkeypatch):
    archive, _, _, _ = synthetic
    monkeypatch.setattr(module, "REVIEWED_ARCHIVE_SHA256", "0" * 64)
    output = tmp_path / "site"
    with pytest.raises(module.PreparationError) as caught:
        prepare(synthetic, output)
    assert str(archive) not in str(caught.value)
    assert not output.exists()


def test_rejects_existing_nonempty_output(synthetic, tmp_path):
    output = tmp_path / "site"
    output.mkdir()
    marker = output / "keep.txt"
    marker.write_text("keep")
    with pytest.raises(module.PreparationError, match="absent or empty"):
        prepare(synthetic, output)
    assert marker.read_text() == "keep"


def test_accepts_existing_empty_output(synthetic, tmp_path):
    output = tmp_path / "site"
    output.mkdir()
    prepare(synthetic, output)
    assert (output / "releases" / synthetic[3] / "index.html").is_file()


def test_rejects_output_inside_repository(synthetic, tmp_path, monkeypatch):
    repository = tmp_path / "repository"
    repository.mkdir()
    monkeypatch.setattr(module, "REPOSITORY_ROOT", repository)
    with pytest.raises(module.PreparationError, match="outside the repository"):
        prepare(synthetic, repository / "deployment")


def test_rejects_output_and_archive_symlinks(synthetic, tmp_path):
    archive, _, _, _ = synthetic
    output_target = tmp_path / "output-target"
    output_target.mkdir()
    output_link = tmp_path / "output-link"
    output_link.symlink_to(output_target, target_is_directory=True)
    with pytest.raises(module.PreparationError, match="symbolic link"):
        prepare(synthetic, output_link)

    archive_link = tmp_path / "archive-link.zip"
    archive_link.symlink_to(archive)
    with pytest.raises(module.PreparationError, match="regular file"):
        module.prepare(
            zip_path=archive_link,
            cdn_origin="https://cdn.example.test",
            lobby_origin="http://127.0.0.1:8100",
            output_dir=tmp_path / "site",
        )


@pytest.mark.parametrize(
    ("unsafe_name", "kind"),
    [
        ("../escape.txt", "file"),
        ("/absolute.txt", "file"),
        ("assets/../../escape.txt", "file"),
        ("assets\\escape.txt", "file"),
        ("assets/link", "symlink"),
    ],
)
def test_rejects_traversal_absolute_backslash_and_symlink_members(
    synthetic, tmp_path, monkeypatch, unsafe_name, kind
):
    _, entries, _, _ = synthetic
    archive = tmp_path / "unsafe.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as target:
        for relative, payload in entries.items():
            target.writestr(module.ARCHIVE_PREFIX + relative, payload)
        member = ZipInfo(module.ARCHIVE_PREFIX + unsafe_name)
        if kind == "symlink":
            member.create_system = 3
            member.external_attr = (stat.S_IFLNK | 0o777) << 16
        target.writestr(member, b"../target")
    monkeypatch.setattr(module, "REVIEWED_ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest())
    output = tmp_path / "site"
    with pytest.raises(module.PreparationError, match="unsafe member|nonregular member"):
        module.prepare(
            zip_path=archive,
            cdn_origin="https://cdn.example.test",
            lobby_origin="http://127.0.0.1:8100",
            output_dir=output,
        )
    assert not output.exists()
    assert not (tmp_path / "escape.txt").exists()


def test_rejects_duplicate_members(synthetic, tmp_path, monkeypatch):
    _, entries, _, _ = synthetic
    archive = tmp_path / "duplicate.zip"
    with pytest.warns(UserWarning, match="Duplicate name"):
        with ZipFile(archive, "w") as target:
            for relative, payload in entries.items():
                target.writestr(module.ARCHIVE_PREFIX + relative, payload)
            target.writestr(module.ARCHIVE_PREFIX + "assets/bootstrap.js", b"different")
    monkeypatch.setattr(module, "REVIEWED_ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest())
    with pytest.raises(module.PreparationError, match="duplicate"):
        module.prepare(
            zip_path=archive,
            cdn_origin="https://cdn.example.test",
            lobby_origin="http://127.0.0.1:8100",
            output_dir=tmp_path / "site",
        )


def test_rejects_missing_required_manifest_asset(synthetic, tmp_path, monkeypatch):
    _, entries, _, _ = synthetic
    archive = tmp_path / "missing.zip"
    missing = module.EARLY_ASSETS[0][1]
    with ZipFile(archive, "w") as target:
        for relative, payload in entries.items():
            if relative != missing:
                target.writestr(module.ARCHIVE_PREFIX + relative, payload)
    monkeypatch.setattr(module, "REVIEWED_ARCHIVE_SHA256", hashlib.sha256(archive.read_bytes()).hexdigest())
    with pytest.raises(module.PreparationError, match="missing required"):
        module.prepare(
            zip_path=archive,
            cdn_origin="https://cdn.example.test",
            lobby_origin="http://127.0.0.1:8100",
            output_dir=tmp_path / "site",
        )


def test_rejects_cdn_equal_to_lobby(synthetic, tmp_path):
    with pytest.raises(module.PreparationError, match="distinct"):
        prepare(
            synthetic,
            tmp_path / "site",
            cdn_origin="https://same.example.test",
            lobby_origin="https://same.example.test",
        )
