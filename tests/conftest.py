from pathlib import Path

import pytest
import yaml

from skku_notice import cli


@pytest.fixture(autouse=True)
def two_original_boards(tmp_path_factory, monkeypatch):
    """실행 테스트는 처음 두 게시판으로 고정한다. 게시판을 더해도 결과 수가 흔들리지 않게 한다.
    더한 게시판은 tests/test_parse.py의 파서 테스트가 따로 본다."""
    settings = yaml.safe_load(Path("config/sources.yaml").read_text(encoding="utf-8"))
    settings["sources"] = [s for s in settings["sources"] if s["id"] in ("skku-notice01", "cse-notice")]
    path = tmp_path_factory.mktemp("config") / "sources.yaml"
    path.write_text(yaml.safe_dump(settings, allow_unicode=True), encoding="utf-8")
    monkeypatch.setattr(cli, "SOURCES_PATH", path)
