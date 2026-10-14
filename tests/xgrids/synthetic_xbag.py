"""
Builds small synthetic XBAG-like files with the layout index_xbin.py expects
(docs/xgrids/xbag-format.md). No real scan data: the "H.264" payloads are the
SPS signature followed by filler, so they index correctly but don't decode.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

SPS_SIGNATURE = bytes.fromhex("00 00 00 01 67 64 10 3c")
BASE_US = 1_784_110_216_490_409  # 2026-07-15T10:10:16.490409Z, the Basel recording's first frame


def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def zigzag(value: int) -> int:
    return (value << 1) ^ (value >> 63)


def fake_h264(size: int = 2_000, seed: int = 0) -> bytes:
    """SPS signature, a PPS-like and an IDR-like NAL header, then filler without start codes."""
    body = SPS_SIGNATURE + b"\x00\x00\x00\x01\x68\xee" + b"\x00\x00\x01\x65"
    filler = bytes(0x40 + (i * 7 + seed) % 0x3F for i in range(size - len(body)))
    return body + filler


def image_message(sequence: int, timestamp_us: int, h264: bytes, width: int = 4000, height: int = 3000) -> bytes:
    header = (b"\x08" + varint(sequence) if sequence else b"") + b"\x10" + varint(zigzag(timestamp_us)) + b"\x18" + varint(20000)
    trailer = b"\x08\x01\x10\x02\x18\x03\x00"
    body = (
        b"\x0a" + varint(len(header)) + header
        + b"\x10\x03" + b"\x18" + varint(width) + b"\x20" + varint(height)
        + b"\x2a" + varint(len(h264)) + h264
        + b"\x32" + varint(len(trailer)) + trailer
    )
    return b"\x0a" + varint(len(body)) + body


def record(channel: int, messages: list[bytes], first_us: int, last_us: int, count: int | None = None) -> bytes:
    payload = b"".join(messages)
    header = struct.pack(
        "<IHHQIIQQII", len(payload) + 52, 1, 36, last_us + 1_000, len(payload),
        len(messages) if count is None else count, first_us, last_us, channel, len(payload),
    )
    return header + payload + b"\x00\x00\x00\x00"


@dataclass
class Shot:
    channel: int
    sequence: int
    timestamp_us: int
    h264: bytes


def camera_records(shots: list[Shot], per_record: int = 5, count_override: dict[int, int] | None = None) -> list[bytes]:
    """Groups consecutive shots of the same channel into records of up to per_record messages."""
    records = []
    for i in range(0, len(shots), per_record):
        group = shots[i : i + per_record]
        assert len({s.channel for s in group}) == 1
        count = (count_override or {}).get(len(records))
        records.append(record(group[0].channel, [image_message(s.sequence, s.timestamp_us, s.h264) for s in group],
                              group[0].timestamp_us, group[-1].timestamp_us, count))
    return records


def write_xbag(path: Path, records: list[bytes]) -> None:
    path.write_bytes(b"XBAG" + bytes(60) + b"".join(records))
