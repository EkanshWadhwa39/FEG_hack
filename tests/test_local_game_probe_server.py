"""Synthetic tests only: no provider archive needed."""

from io import BytesIO
from zipfile import ZipFile

import pytest

from tools.local_game_probe_server import inventory, member_for_path


@pytest.mark.parametrize("path", ["/../secret", "/%2e%2e/secret", "/a/./b", "/a%5cb", "/a%00b"])
def test_rejects_unsafe_paths(path):
    assert member_for_path(path) is None


def test_maps_archive_member_without_rewriting_browser_url():
    assert member_for_path("/") == "empireofgold/index.html"
    assert member_for_path("/assets/a.js?v=exact") == "empireofgold/assets/a.js"
    assert member_for_path("/assets/%401x/a.png") == "empireofgold/assets/@1x/a.png"


def test_inventory_reports_unresolved_atlas_pages_without_source_or_urls():
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("empireofgold/assets/spines/@1x/test.atlas", "missing.png\nsize: 1,1\n")
        archive.writestr("empireofgold/index.html", "<title>Synthetic</title>")
    with ZipFile(buffer) as archive:
        result = inventory(archive)
    assert result["file_count"] == 2
    assert result["unresolved_atlas_page_references"] == 1
    assert result["unresolved_atlas_pages_by_tier"] == {"1x": 1}
    assert result["book_image_present"] is False
    assert result["offline_module_present"] is False
    assert "missing.png" not in str(result)
