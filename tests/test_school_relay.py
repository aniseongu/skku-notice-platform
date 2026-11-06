import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path("scripts/relay_school.sh").resolve()


@pytest.mark.parametrize(("active", "expected"), [("0", "collect-school.yml"), ("1", "relay-school.yml")])
def test_relay_dispatches_collection_or_rearms_when_busy(tmp_path, active, expected):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sleep = bin_dir / "sleep"
    sleep.write_text("#!/bin/sh\nexit 0\n")
    gh = bin_dir / "gh"
    gh.write_text(
        "#!/bin/sh\n"
        'if [ "$1" = run ]; then echo "$FAKE_ACTIVE"; '
        'else printf "%s\\n" "$*" >> "$FAKE_LOG"; fi\n'
    )
    sleep.chmod(0o755)
    gh.chmod(0o755)
    log = tmp_path / "calls"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_ACTIVE": active,
        "FAKE_LOG": str(log),
        "GITHUB_REF_NAME": "main",
        "RELAY_DELAY_SECONDS": "10",
    }
    result = subprocess.run(["bash", str(SCRIPT)], env=env, text=True, capture_output=True, check=False)
    assert result.returncode == 0, result.stderr
    assert f"workflow run {expected} --ref main" in log.read_text()


def test_relay_rejects_unbounded_or_malformed_delay(tmp_path):
    for delay in ["0", "3301", "10;echo hacked", "-1"]:
        result = subprocess.run(
            ["bash", str(SCRIPT)],
            env={**os.environ, "RELAY_DELAY_SECONDS": delay},
            text=True,
            capture_output=True,
            check=False,
            timeout=2,
        )
        assert result.returncode != 0
