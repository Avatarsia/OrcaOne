import hashlib
from pathlib import Path

import pytest

from orcaone import conf as conf_module
from orcaone.conf import dump_conf, parse_conf, read_conf

FIXTURES = Path(__file__).parent / "fixtures"
CONF_FILES = [
    "snorca/Snapmaker_Orca.conf",
    "conf/snorca_linux.conf",
    "conf/orca_tab.conf",
    "conf/snorca_windows.conf",
]


@pytest.mark.parametrize("name", CONF_FILES)
def test_round_trip_is_byte_identical(name):
    raw = (FIXTURES / name).read_bytes()
    assert dump_conf(parse_conf(raw)) == raw


def test_detects_format():
    linux = read_conf(FIXTURES / "conf/snorca_linux.conf")
    assert (linux.indent, linux.checksum, linux.crlf) == ("    ", False, False)
    orca = read_conf(FIXTURES / "conf/orca_tab.conf")
    assert orca.indent == "\t"
    windows = read_conf(FIXTURES / "conf/snorca_windows.conf")
    assert (windows.checksum, windows.crlf) == (True, True)
    assert windows.data == linux.data


def test_checksum_is_recomputed_after_a_change():
    conf = read_conf(FIXTURES / "conf/snorca_windows.conf")
    conf.data["filaments"].append("SUNLU PLA+ @System")
    text = dump_conf(conf).decode("utf-8").replace("\r\n", "\n")
    body, _, checksum_line = text.rstrip("\n").rpartition("\n")
    assert checksum_line == "# MD5 checksum " + hashlib.md5(body.encode("utf-8")).hexdigest().upper()
    assert "SUNLU PLA+ @System" in body


def test_non_ascii_stays_raw():
    conf = read_conf(FIXTURES / "conf/orca_tab.conf")
    assert "Größe" in dump_conf(conf).decode("utf-8")


def test_reads_a_conf_with_byte_order_mark():
    raw = (FIXTURES / "conf/snorca_linux.conf").read_bytes()
    conf = parse_conf(b"\xef\xbb\xbf" + raw)
    assert conf.data["header"] == "Snapmaker Orca 2.4.0"
    # Written back without BOM, like the slicer does on its next save.
    assert dump_conf(conf) == raw


def test_rejects_anything_but_an_object():
    with pytest.raises(ValueError):
        parse_conf(b"[]\n")
    with pytest.raises(ValueError):
        parse_conf(b"{ broken\n")


def test_rejects_what_nlohmann_rejects():
    # Python reads NaN and unpaired surrogates, the slicers do not: they would reset the .conf.
    with pytest.raises(ValueError):
        parse_conf(b'{"x": NaN}\n')
    with pytest.raises(ValueError):
        parse_conf(b'{"x": "\\ud800"}\n')
    assert parse_conf(b'{"x": "\\ud83d\\ude00"}\n').data == {"x": "\U0001F600"}


def test_read_conf_looks_twice(tmp_path, monkeypatch):
    """The slicer deletes the .conf right before it renames the new one into place (FINDINGS 4.3)."""
    raw = (FIXTURES / "conf/snorca_linux.conf").read_bytes()
    path = tmp_path / "Snapmaker_Orca.conf"
    monkeypatch.setattr(conf_module.time, "sleep", lambda seconds: path.write_bytes(raw))
    assert read_conf(path).data["header"] == "Snapmaker Orca 2.4.0"
    path.unlink()
    monkeypatch.setattr(conf_module.time, "sleep", lambda seconds: None)
    with pytest.raises(OSError):
        read_conf(path)
