#!/usr/bin/env python3
"""Feasibility probe: read an OrcaSlicer vendor preset cache (<vendor>.opc).

Standard library only. Layout follows OrcaSlicer main (2.5.0-dev):
src/libslic3r/PresetCacheFormat.{hpp,cpp}, Config.hpp, Preset.hpp, Semver.hpp,
serialized through cereal's BinaryArchive (native byte order = little endian on
every platform Orca ships; sizes are uint64).

Usage: opc_read.py FILE.opc [--dump]
"""
import json
import math
import struct
import sys
import zlib
from dataclasses import dataclass, field

CACHE_MAGIC = 0x4F52435A  # "ORCZ", stored little endian -> bytes "ZCRO"
SUPPORTED_CACHE_VERSIONS = {1}  # CACHE_VERSION in PresetCacheFormat.cpp
HEADER = struct.Struct("<IIQI")  # magic, version, data_size, crc32 (#pragma pack(1), 20 bytes)

INT_MAX = 2**31 - 1   # nil of ConfigOptionIntsNullable / EnumsGenericNullable
BOOL_NIL = 255        # nil of ConfigOptionBoolsNullable (unsigned char max)
ENUM_UNNAMED = 0      # CacheDictionary::ENUM_UNNAMED

# ConfigOptionType (Config.hpp). Vector types are scalar + 0x4000.
VEC = 0x4000
CO_FLOAT, CO_INT, CO_STRING, CO_PERCENT, CO_FLOAT_OR_PERCENT = 1, 2, 3, 4, 5
CO_POINT, CO_POINT3, CO_BOOL, CO_ENUM = 6, 7, 8, 9
CO_FLOATS, CO_INTS, CO_STRINGS, CO_PERCENTS = VEC + 1, VEC + 2, VEC + 3, VEC + 4
CO_FLOATS_OR_PERCENTS, CO_POINTS, CO_BOOLS, CO_ENUMS = VEC + 5, VEC + 6, VEC + 8, VEC + 9
CO_POINTS_GROUPS, CO_INTS_GROUPS = VEC + 10, VEC + 11

TYPE_NAMES = {
    CO_FLOAT: "coFloat", CO_INT: "coInt", CO_STRING: "coString", CO_PERCENT: "coPercent",
    CO_FLOAT_OR_PERCENT: "coFloatOrPercent", CO_POINT: "coPoint", CO_POINT3: "coPoint3",
    CO_BOOL: "coBool", CO_ENUM: "coEnum", CO_FLOATS: "coFloats", CO_INTS: "coInts",
    CO_STRINGS: "coStrings", CO_PERCENTS: "coPercents", CO_FLOATS_OR_PERCENTS: "coFloatsOrPercents",
    CO_POINTS: "coPoints", CO_BOOLS: "coBools", CO_ENUMS: "coEnums",
    CO_POINTS_GROUPS: "coPointsGroups", CO_INTS_GROUPS: "coIntsGroups",
}


class OpcError(Exception):
    pass


class Reader:
    """Sequential reader for cereal's BinaryInputArchive encoding."""

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def take(self, n: int) -> bytes:
        end = self.pos + n
        if n < 0 or end > len(self.data):
            raise OpcError(f"truncated at offset {self.pos}, wanted {n} bytes")
        chunk = self.data[self.pos:end]
        self.pos = end
        return chunk

    def unpack(self, fmt: str):
        s = struct.Struct("<" + fmt)
        return s.unpack(self.take(s.size))

    def u8(self): return self.unpack("B")[0]
    def u16(self): return self.unpack("H")[0]
    def u32(self): return self.unpack("I")[0]
    def i32(self): return self.unpack("i")[0]
    def u64(self): return self.unpack("Q")[0]
    def f64(self): return self.unpack("d")[0]
    def boolean(self): return self.u8() != 0  # cereal writes bool as one byte

    def size(self) -> int:
        # cereal::size_type (uint64). The bound only guards against garbage;
        # nothing legitimate in a cache comes close.
        n = self.u64()
        if n > len(self.data) - self.pos:
            raise OpcError(f"implausible size {n} at offset {self.pos - 8}")
        return n

    def string(self) -> str:
        raw = self.take(self.size())
        # Orca stores std::string bytes; profiles are UTF-8. Keep undecodable
        # bytes instead of failing, a profile may carry stray Latin-1.
        return raw.decode("utf-8", errors="surrogateescape")

    def strings(self):
        return [self.string() for _ in range(self.size())]

    def array(self, fmt: str, count: int):
        # std::vector of an arithmetic type: one binary block.
        if count == 0:
            return []
        return list(struct.unpack(f"<{count}{fmt}", self.take(count * struct.calcsize(fmt))))


# ---------------------------------------------------------------- data model

@dataclass
class Dictionary:
    keys: list
    types: list
    enum_values: list  # [0] is always ""


@dataclass
class PrinterModel:
    id: str
    name: str
    model_id: str
    technology: int  # PrinterTechnology: 0 FFF, 1 SLA, 2 Unknown, 3 Any
    family: str
    variants: list
    default_materials: list
    not_support_bed_types: list
    bed_model: str
    bed_texture: str
    image_bed_type: str
    bottom_texture_end_name: str
    use_double_extruder_default_texture: str
    bottom_texture_rect: str
    bottom_texture_rect_longer: str
    middle_texture_rect: str
    hotend_model: str


@dataclass
class VendorProfile:
    name: str
    id: str
    config_version: str  # Semver as "major.minor.patch" (save_minimal -> to_string_sf)
    config_update_url: str
    changelog_url: str
    models: list
    default_filaments: list
    default_sla_materials: list


@dataclass
class Option:
    type: int     # ConfigOptionType as written by the writer
    value: object  # python value, see read_option()


@dataclass
class Entry:
    name: str
    sub_path: str
    config: dict  # opt_key -> Option (the preset's own diff, nothing inherited)
    inherits: str
    description: str
    instantiation: str
    setting_id: str
    filament_id: str
    renamed_from: list


@dataclass
class VendorCache:
    header_version: int
    cache_version: int
    vendor_name: str
    vendor_version: str  # Semver::to_string(), BBS 4-part form "2.4.0.15"
    dictionary: Dictionary
    vendors: dict
    process: list = field(default_factory=list)
    filament: list = field(default_factory=list)
    machine: list = field(default_factory=list)
    parse_errors: int = 0


# ---------------------------------------------------------------- readers

def read_printer_model(r: Reader) -> PrinterModel:
    # Field order = PrinterModel::serialize() in Preset.hpp.
    return PrinterModel(
        id=r.string(), name=r.string(), model_id=r.string(), technology=r.u8(),
        family=r.string(),
        variants=[r.string() for _ in range(r.size())],  # PrinterVariant = { name }
        default_materials=r.strings(), not_support_bed_types=r.strings(),
        bed_model=r.string(), bed_texture=r.string(), image_bed_type=r.string(),
        bottom_texture_end_name=r.string(), use_double_extruder_default_texture=r.string(),
        bottom_texture_rect=r.string(), bottom_texture_rect_longer=r.string(),
        middle_texture_rect=r.string(), hotend_model=r.string(),
    )


def read_vendor_profile(r: Reader) -> VendorProfile:
    # Field order = VendorProfile::serialize(); std::set is size + elements.
    return VendorProfile(
        name=r.string(), id=r.string(), config_version=r.string(),
        config_update_url=r.string(), changelog_url=r.string(),
        models=[read_printer_model(r) for _ in range(r.size())],
        default_filaments=r.strings(), default_sla_materials=r.strings(),
    )


def read_enum(r: Reader, type_code: int, dic: Dictionary):
    # Written by save_enum_option(): uint32 count, then per value a uint16 index
    # into the enum-name table; index 0 is followed by the raw int32.
    count = r.u32()
    if type_code == CO_ENUM and count != 1:
        raise OpcError("scalar enum with more than one value")
    values = []
    for _ in range(count):
        idx = r.u16()
        if idx >= len(dic.enum_values):
            raise OpcError(f"enum index {idx} past the dictionary")
        values.append(r.i32() if idx == ENUM_UNNAMED else dic.enum_values[idx])
    return values[0] if type_code == CO_ENUM else values


def read_option(r: Reader, type_code: int, dic: Dictionary):
    """Python value of one option.

    float/int/str/bool for scalars; FloatOrPercent -> (value, is_percent);
    Point -> (x, y); Point3 -> (x, y, z); enums -> name, or raw int where the
    writer had no name (nil = INT_MAX); vectors -> list of the above.
    Nil stays in its raw form: NaN, INT_MAX, 255.
    """
    t = type_code
    if t in (CO_ENUM, CO_ENUMS):
        return read_enum(r, t, dic)
    if t in (CO_FLOAT, CO_PERCENT):
        return r.f64()
    if t == CO_INT:
        return r.i32()
    if t == CO_STRING:
        return r.string()
    if t == CO_FLOAT_OR_PERCENT:
        return (r.f64(), r.boolean())
    if t == CO_POINT:
        return r.unpack("dd")
    if t == CO_POINT3:
        return r.unpack("ddd")
    if t == CO_BOOL:
        return r.boolean()
    if t in (CO_FLOATS, CO_PERCENTS):
        return r.array("d", r.size())
    if t == CO_INTS:
        return r.array("i", r.size())
    if t == CO_STRINGS:
        return r.strings()
    if t == CO_BOOLS:
        return r.array("B", r.size())  # vector<unsigned char>, 255 = nil
    if t == CO_FLOATS_OR_PERCENTS:
        return [(r.f64(), r.boolean()) for _ in range(r.size())]
    if t == CO_POINTS:
        # Hand-written save(): size_t count + raw Vec2d block; same bytes as cereal.
        flat = r.array("d", r.size() * 2)
        return list(zip(flat[0::2], flat[1::2]))
    if t == CO_POINTS_GROUPS:
        groups = []
        for _ in range(r.size()):
            flat = r.array("d", r.size() * 2)
            groups.append(list(zip(flat[0::2], flat[1::2])))
        return groups
    if t == CO_INTS_GROUPS:
        return [r.array("i", r.size()) for _ in range(r.size())]
    raise OpcError(f"unknown option type 0x{t:04x}")


def read_config(r: Reader, dic: Dictionary) -> dict:
    config = {}
    for _ in range(r.u32()):
        idx = r.u16()
        if idx >= len(dic.keys):
            raise OpcError(f"option index {idx} past the dictionary")
        t = dic.types[idx]
        config[dic.keys[idx]] = Option(t, read_option(r, t, dic))
    return config


def read_entries(r: Reader, dic: Dictionary) -> list:
    entries = []
    for _ in range(r.u32()):
        # visit_entry(): name, sub_path, config, then the remaining strings.
        name, sub_path = r.string(), r.string()
        config = read_config(r, dic)
        entries.append(Entry(name, sub_path, config, inherits=r.string(), description=r.string(),
                             instantiation=r.string(), setting_id=r.string(),
                             filament_id=r.string(), renamed_from=r.strings()))
    return entries


def read_opc(path: str) -> VendorCache:
    with open(path, "rb") as f:
        blob = f.read()
    if len(blob) < HEADER.size:
        raise OpcError("file shorter than the header")
    magic, header_version, data_size, crc = HEADER.unpack_from(blob)
    if magic != CACHE_MAGIC:
        raise OpcError(f"bad magic 0x{magic:08x}")
    body = blob[HEADER.size:]
    if data_size == 0 or data_size != len(body):
        raise OpcError(f"data_size {data_size} != body length {len(body)}")
    if zlib.crc32(body) != crc:  # boost::crc_32_type == zlib CRC-32
        raise OpcError("CRC mismatch")
    if header_version not in SUPPORTED_CACHE_VERSIONS:
        raise OpcError(f"unsupported cache version {header_version}")

    r = Reader(body)
    cache_version = r.u32()
    if cache_version not in SUPPORTED_CACHE_VERSIONS:
        raise OpcError(f"unsupported cache version {cache_version}")
    vendor_name, vendor_version = r.string(), r.string()

    keys = r.strings()
    types = r.array("H", r.size())
    enum_values = r.strings()
    if len(keys) != len(types) or not enum_values or enum_values[0] != "":
        raise OpcError("malformed dictionary")
    dic = Dictionary(keys, types, enum_values)

    vendors = {}
    for _ in range(r.size()):
        key = r.string()
        vendors[key] = read_vendor_profile(r)

    cache = VendorCache(header_version, cache_version, vendor_name, vendor_version, dic, vendors)
    cache.process = read_entries(r, dic)
    cache.filament = read_entries(r, dic)
    cache.machine = read_entries(r, dic)
    cache.parse_errors = r.u64()
    if r.pos != len(body):
        raise OpcError(f"{len(body) - r.pos} trailing bytes")
    return cache


# ---------------------------------------------------------------- JSON string form

def fmt_double(v: float) -> str:
    # std::ostream << double with default flags: precision 6, like printf("%g").
    return "%g" % v


def _scalar_json(t: int, v) -> str:
    if t in (CO_FLOAT, CO_FLOATS):
        return "nil" if math.isnan(v) else fmt_double(v)
    if t in (CO_PERCENT, CO_PERCENTS):
        return "nil" if math.isnan(v) else fmt_double(v) + "%"
    if t in (CO_FLOAT_OR_PERCENT, CO_FLOATS_OR_PERCENTS):
        val, pct = v
        return "nil" if math.isnan(val) else fmt_double(val) + ("%" if pct else "")
    if t in (CO_INT, CO_INTS):
        # The cache does not say whether an option is nullable. INT_MAX is nil
        # for every nullable int option and no real setting uses it.
        return "nil" if (t == CO_INTS and v == INT_MAX) else str(v)
    if t in (CO_BOOL, CO_BOOLS):
        return "nil" if v == BOOL_NIL else ("1" if v else "0")
    if t in (CO_ENUM, CO_ENUMS):
        if isinstance(v, str):
            return v
        return "nil" if v == INT_MAX else str(v)  # unnamed raw int
    if t in (CO_STRING, CO_STRINGS):
        return v  # JSON keeps the raw string (save_to_json), not escape_string_cstyle
    raise OpcError(f"no scalar form for type 0x{t:04x}")


def to_json_value(opt: Option):
    """The value as ConfigBase::save_to_json writes it: serialize() for scalars
    (coString raw), vserialize() for vectors (a list of strings)."""
    t, v = opt.type, opt.value
    if t == CO_POINT:
        return f"{fmt_double(v[0])},{fmt_double(v[1])}"
    if t == CO_POINT3:
        return ",".join(fmt_double(c) for c in v)
    if t == CO_POINTS:
        return [f"{fmt_double(x)}x{fmt_double(y)}" for x, y in v]
    if t == CO_POINTS_GROUPS:
        return [",".join(f"{fmt_double(x)}x{fmt_double(y)}" for x, y in g) for g in v]
    if t == CO_INTS_GROUPS:
        return [",".join(str(i) for i in g) for g in v]
    if t & VEC:
        return [_scalar_json(t, x) for x in v]
    return _scalar_json(t, v)


def entry_to_json(entry: Entry, kind: str) -> dict:
    """An approximation of the preset's JSON subfile (metadata + own values)."""
    out = {"type": kind, "name": entry.name}
    if entry.inherits:
        out["inherits"] = entry.inherits
    out["from"] = "system"
    for key in ("setting_id", "filament_id", "instantiation", "description"):
        if getattr(entry, key):
            out[key] = getattr(entry, key)
    if entry.renamed_from:
        out["renamed_from"] = entry.renamed_from
    for k in sorted(entry.config):
        out[k] = to_json_value(entry.config[k])
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cache = read_opc(argv[1])
    print(f"vendor {cache.vendor_name} {cache.vendor_version}  cache_version {cache.cache_version}")
    print(f"dictionary: {len(cache.dictionary.keys)} keys, {len(cache.dictionary.enum_values) - 1} enum names")
    for name, vp in cache.vendors.items():
        print(f"vendor map: {name!r} id={vp.id} version={vp.config_version} models={len(vp.models)}")
    print(f"process {len(cache.process)}  filament {len(cache.filament)}  machine {len(cache.machine)}"
          f"  parse_errors {cache.parse_errors}")
    if "--dump" in argv:
        kinds = (("process", cache.process), ("filament", cache.filament), ("machine", cache.machine))
        dump = {kind: [entry_to_json(e, kind) for e in entries] for kind, entries in kinds}
        json.dump(dump, sys.stdout, indent=1, ensure_ascii=False)
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
