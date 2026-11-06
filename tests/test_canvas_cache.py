import json

import pytest

from skku_notice.canvas_cache import main, open_cache, seal_cache


@pytest.fixture
def files(tmp_path):
    return tmp_path / "canvas.json", tmp_path / "canvas.enc"


def test_cache_roundtrip_is_opaque_and_private(files):
    plain, encrypted = files
    content = json.dumps({"notified": {"assignment:123456": "2026-11-04"}}).encode()
    plain.write_bytes(content)

    assert seal_cache("test-canvas-token", plain, encrypted)
    assert b"assignment" not in encrypted.read_bytes()
    assert encrypted.stat().st_mode & 0o077 == 0
    plain.unlink()
    assert open_cache("test-canvas-token", plain, encrypted)
    assert plain.read_bytes() == content
    assert plain.stat().st_mode & 0o077 == 0


def test_rotated_key_discards_existing_plaintext(files):
    plain, encrypted = files
    plain.write_text("private-baseline")
    seal_cache("old-token", plain, encrypted)
    assert not open_cache("new-token", plain, encrypted)
    assert not plain.exists()


def test_tampered_ciphertext_never_restores_plaintext(files):
    plain, encrypted = files
    plain.write_text("private-baseline")
    seal_cache("test-token", plain, encrypted)
    damaged = bytearray(encrypted.read_bytes())
    damaged[len(damaged) // 2] ^= 1
    encrypted.write_bytes(damaged)
    assert not open_cache("test-token", plain, encrypted)
    assert not plain.exists()


def test_no_cache_or_key_starts_without_old_plaintext(files):
    plain, encrypted = files
    plain.write_text("stale-baseline")
    assert not open_cache("test-token", plain, encrypted)
    assert not plain.exists()
    encrypted.write_text("ciphertext")
    plain.write_text("stale-baseline")
    assert not open_cache("", plain, encrypted)
    assert not plain.exists()


def test_seal_without_input_skips_but_input_without_key_fails(files):
    plain, encrypted = files
    encrypted.write_text("old-ciphertext")
    assert not seal_cache("", plain, encrypted)
    assert not encrypted.exists()
    plain.write_text("private-baseline")
    with pytest.raises(ValueError, match="unavailable"):
        seal_cache("", plain, encrypted)
    assert not encrypted.exists()


def test_cli_failures_never_log_source_or_key(files, monkeypatch, capsys):
    plain, encrypted = files
    plain.write_text("sensitive-marker")
    args = ["seal", "--plain", str(plain), "--encrypted", str(encrypted)]
    monkeypatch.delenv("CANVAS_TOKEN", raising=False)
    assert main(args) == 1
    logged = capsys.readouterr()
    assert logged.out == ""
    assert logged.err == "Canvas cache operation failed\n"
    monkeypatch.setenv("CANVAS_TOKEN", "test-secret-key")
    assert main(args) == 0
    assert main(["open", *args[1:]]) == 0
    logged = capsys.readouterr()
    assert logged.out == logged.err == ""


def test_restored_cache_preserves_refresh_age_across_runs(files):
    import os
    import time

    plain, encrypted = files
    plain.write_text("private-baseline")
    refreshed_at_ns = time.time_ns() - 2 * 60 * 60 * 1_000_000_000
    os.utime(plain, ns=(refreshed_at_ns, refreshed_at_ns))

    for _ in range(3):
        assert seal_cache("test-token", plain, encrypted)
        plain.unlink()
        assert open_cache("test-token", plain, encrypted)
        assert plain.stat().st_mtime_ns == refreshed_at_ns
        assert time.time() - plain.stat().st_mtime >= 30 * 60


@pytest.mark.parametrize("envelope", [
    b"legacy-unwrapped-state",
    b"{}",
    b'[]',
    b'{"version":2,"mtime_ns":1,"content":"e30="}',
    b'{"version":1,"mtime_ns":true,"content":"e30="}',
    b'{"version":1,"mtime_ns":-1,"content":"e30="}',
    b'{"version":1,"mtime_ns":9223372036854775808,"content":"e30="}',
    b'{"version":1,"mtime_ns":1,"content":"invalid%base64"}',
])
def test_invalid_authenticated_envelope_starts_without_plaintext(files, envelope):
    from skku_notice.canvas_cache import _cipher

    plain, encrypted = files
    encrypted.write_bytes(_cipher("test-token").encrypt(envelope))
    plain.write_text("stale-baseline")
    assert not open_cache("test-token", plain, encrypted)
    assert not plain.exists()
