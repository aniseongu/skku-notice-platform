import pytest

from skku_notice.byok_crypto import ByokCryptoError, b64encode, decrypt_api_key, encrypt_api_key

MASTER = "a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s"
USER = "00000000-0000-0000-0000-000000000001"
KEY = "AIza" + "A" * 35
VECTOR = "aWlpaWlpaWlpaWlpm82CFXO54EW6FaA52lZkJtPlP0teevcNZHwPgEmJpx5G89PtYPFfXvVYdQ6IB5-Wqx6Ka1xirQ"


def test_reads_the_vector_shared_with_the_edge_function_tests():
    assert b64encode(b"k" * 32) == MASTER
    assert decrypt_api_key(MASTER, USER, VECTOR) == KEY
    assert encrypt_api_key(MASTER, USER, KEY, b"i" * 12) == VECTOR


def test_other_user_tampering_and_bad_inputs_fail_without_leaking():
    with pytest.raises(ByokCryptoError) as other:
        decrypt_api_key(MASTER, "00000000-0000-0000-0000-000000000002", VECTOR)
    assert KEY not in str(other.value) and VECTOR not in str(other.value)
    for bad in ("AAAA", "", VECTOR[:-2] + "AA"):
        with pytest.raises(ByokCryptoError):
            decrypt_api_key(MASTER, USER, bad)
    with pytest.raises(ByokCryptoError):
        decrypt_api_key("c2hvcnQ", USER, VECTOR)
