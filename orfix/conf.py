"""Read and write <APP_KEY>.conf byte for byte the way the slicers do.

Both slicers dump nlohmann::json with sorted keys, raw UTF-8 and a trailing
newline (AppConfig::save). Snapmaker Orca and OrcaSlicer <= 2.3.2 indent with
4 spaces, OrcaSlicer >= 2.4.0 with one tab per level. On Windows a line
"# MD5 checksum <HEX>" follows, hashed over the JSON text without its trailing
newline (appconfig_md5_hash_line), and the file is written in text mode.
Details: docs/FINDINGS.md, section 4.3.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

CHECKSUM_PREFIX = "# MD5 checksum "
_CHECKSUM_LINE = re.compile(r"\n# MD5 checksum [0-9A-Fa-f]{32}\n?\Z")
_FIRST_INDENT = re.compile(r"\{\n([ \t]+)\S")


@dataclass
class ConfFile:
    data: dict
    indent: str = "    "
    checksum: bool = False
    crlf: bool = False


def parse_conf(raw: bytes) -> ConfFile:
    """Parse the file content. Raises ValueError if it is not a JSON object."""
    text = raw.decode("utf-8")
    crlf = "\r\n" in text
    if crlf:
        text = text.replace("\r\n", "\n")
    match = _CHECKSUM_LINE.search(text)
    if match:
        text = text[:match.start()]
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("conf is not a JSON object")
    indent = _FIRST_INDENT.match(text)
    return ConfFile(
        data=data,
        indent=indent.group(1) if indent else "    ",
        checksum=match is not None,
        crlf=crlf,
    )


def read_conf(path: Path) -> ConfFile:
    return parse_conf(path.read_bytes())


def dump_conf(conf: ConfFile) -> bytes:
    text = json.dumps(conf.data, indent=conf.indent, ensure_ascii=False, sort_keys=True)
    out = text + "\n"
    if conf.checksum:
        digest = hashlib.md5(text.encode("utf-8")).hexdigest().upper()
        out += CHECKSUM_PREFIX + digest + "\n"
    if conf.crlf:
        out = out.replace("\n", "\r\n")
    return out.encode("utf-8")
