# XGRIDS XBAG (`.xbin`) format — what we know

Engineering notes for the raw recording of an XGRIDS **LixelKity K1** handheld scanner, reverse-engineered for Spatial Lab (Labs 13P and 13Q). Tools: [`scripts/xgrids/`](../../scripts/xgrids/README.md). History and corrections: [investigation-log.md](investigation-log.md). Camera geometry: [calibration-notes.md](calibration-notes.md).

> **Scope.** Everything here comes from **one recording**: Basel House, 2026-07-15, `2026-07-15-101012-003.xbin`, 13,929,066,496 bytes. According to its `project_data/log/project.json`, the scanner ran software V3.1.1_20250826, algorithm v2.1.2.20250815.beta and MCU v2.8.4, with a Livox Mid-360 LiDAR. This is **not a specification**. Zero rejected candidates and zero unpaired frames show that the interpretation is consistent with this file. They do not show that it holds for other firmware versions, scan modes, camera settings, or damaged and interrupted recordings. Treat each new recording as a new validation case (see [section 9](#9-using-a-new-recording)).

## 1. File

- Offset 0: ASCII `XBAG`. The tools refuse files without it.
- The bytes between the signature and the first record have not been decoded.
- The rest of the file is a sequence of records from several sensor channels, interleaved in time.

## 2. Records

Each record starts with a 48-byte little-endian header, followed by the payload and then 4 bytes we can't yet explain:

| Offset | Type | Field | Observed |
|---|---|---|---|
| 0 | u32 | record length | always payload length + 52 (48 header + 4 trailing) |
| 4 | u16 | marker | always 1 |
| 6 | u16 | unknown | always 36 |
| 8 | u64 | write time (provisional name) | plausible µs since 1970 UTC; relation to the messages not checked |
| 16 | u32 | payload length | bytes |
| 20 | u32 | message count | 5 for camera records |
| 24 | u64 | first message timestamp | µs; equals the first image's timestamp |
| 32 | u64 | last message timestamp | µs; equals the last image's timestamp |
| 40 | u32 | channel id | see below |
| 44 | u32 | payload length (again) | equals offset 16 |

The indexer finds headers by the bytes `01 00 24 00` at offset +4. It accepts a header only if:
- both payload lengths agree;
- the record length equals payload length + 52;
- the count is plausible;
- the timestamps are plausible and ordered;
- the payload fits inside the file.

Channels seen in the Basel recording:

| Channel | Records | Content |
|---|---|---|
| 14 | 1,459 | camera images (7,295) |
| 18 | 1,459 | camera images (7,295) |
| 1 | 2,432 | not decoded (probably LiDAR or IMU; unverified) |
| 3 | 4,852 | not decoded |
| 0, 21 | 1 each | not decoded |

## 3. Camera channels 14 and 18

- **Separate streams:** each camera channel holds one stream. Sequence numbers run 0–7294 exactly once per channel, and timestamps only increase.
- **Physical cameras not identified:** we don't know which channel is which camera. `project.json` lists the cameras `["left_main", "", "right_main", ""]`. Indices 0 and 2 could map to the channels somehow, but nothing confirms it.
- **Labels:** the tools call the streams `ch14` and `ch18` everywhere: in filenames, CSV columns and summaries.
- **Header check:** a frame gets a stream label only if its record header matches the frames inside the record exactly: the count, the first and last timestamp, and contiguous messages that fill the payload. All 2,918 camera records match.

## 4. Image messages (protobuf)

The payload of a camera record is 5 protobuf messages back to back. Each message holds one image:

```
0a <varint L>                outer message, L bytes
   0a <varint n>             field 1: header
      08 <varint>            field 1: sequence number   (omitted when 0: proto3 default)
      10 <varint>            field 2: timestamp, ZigZag sint64, µs since 1970 UTC
      18 <varint>            field 3: unknown, 20000 in every frame
   10 <varint>               field 2: unknown, 3 in every frame
   18 <varint>               field 3: width  (4000)
   20 <varint>               field 4: height (3000)
   2a <varint m> <m bytes>   field 5: H.264 Annex B stream (section 5)
   32 <varint k> <k bytes>   field 6: unknown small message (7 bytes)
```

**Sequence numbers**
- Varints; the largest seen is 7294 (2 bytes).
- Sequence 0 has **no** `08` field, because protobuf omits default values. A decoder that requires the field misses the first image of each camera.
- The same sequence number on channels 14 and 18 marks one capture event.

**Timestamps**
- Decoded as ZigZag integers: `(v >> 1) ^ -(v & 1)`.
- Kept as exact integer microseconds; UTC strings are built with `datetime + timedelta` and never pass through floats.
- They match the record headers. They share a clock with `project_data/poses.csv`, which starts 17.6 s after the first image and overlaps for 2,418.9 s.
- Whether a timestamp marks the start, middle or end of the exposure is unknown.

**Timing in this recording**
- Images run from 10:10:16.490409 to 10:50:52.990955 UTC: one capture every 0.3 s (about 3.0 Hz). The longest gap is 1.4 s.
- Channel 18 is always first in a pair. The time difference has median 17 µs and maximum 213 µs.

**How the indexer decodes a message**
- It looks back at most 96 bytes from each SPS signature for the outer `0a` tag.
- It accepts a candidate only if:
  - exactly one start position yields fields 1–4 followed by field 5, and field 5's bytes begin exactly at the SPS;
  - the header holds only fields 1–3, with a timestamp between 2015 and 2040;
  - the dimensions are plausible (at most 16384), and the image length is between 1,000 B and 64 MiB;
  - everything after the image up to the outer length is exactly one field 6 of at most 256 bytes.
- Any other candidate is rejected and its reason is reported.

## 5. H.264 payloads

- **Length-prefixed.** Field 5 is a length-prefixed byte string, so an image ends at the declared length `m` (`h264_bytes` in `frames.csv`). It does **not** end at the next SPS, because the field-6 trailer, further messages and record headers lie between images.
- **Self-contained.** Every payload examined begins with the SPS `00 00 00 01 67 64 10 3c` and contains SPS, PPS, SEI, SEI and one IDR slice (NAL types 7, 8, 6, 6, 5).
- **Picture format:** High profile, 4000 × 3000, `yuv420p`, progressive, one picture. Each image therefore decodes on its own, with no reference to other frames.
- **Sizes:** 292,187–716,324 bytes.
- **Discovery heuristic.** The indexer finds images by that exact SPS signature. Another resolution or profile would have a different SPS and **would not be found**. In Basel, the 2,918 camera records declare 14,590 messages, which equals the number of signatures that decoded. So no camera image in this file starts differently.

## 6. Tools and their output

All tools use only the Python standard library; the extractor also needs FFmpeg. They open the recording read-only, and default to writing next to it in `<recording folder>/reconstruction/xgrids/`, outside Git.

**Indexer**

```bash
python3 scripts/xgrids/index_xbin.py /path/to/rec.xbin                     # whole file
python3 scripts/xgrids/index_xbin.py rec.xbin --max-bytes 67108864 --out /tmp/x   # first 64 MiB only
```

- Reads in 16 MiB chunks (`--chunk-mib`); about 22 s for 13.9 GB.
- Optional `--poses`.
- Writes `metadata/frames.csv` and `metadata/index-summary.json`.

`frames.csv` has one row per image, in file order:

| Column | Meaning |
|---|---|
| `sequence`, `timestamp_us`, `timestamp_utc` | decoded metadata; the integer µs value is authoritative |
| `sps_offset` | absolute byte offset of the H.264 bytes (the SPS) |
| `message_offset`, `h264_bytes` | where the protobuf message starts; declared field-5 length |
| `width`, `height` | fields 3 and 4 |
| `camera_stream`, `stream_evidence` | `ch14` / `ch18` when the record header matches, otherwise empty plus the reason |
| `pair_status`, `pair_id`, `pair_dt_us`, `partner_sps_offset` | see below |

Pairing statuses:
- **`paired`:** same sequence, \|Δt\| ≤ 5 ms, different streams, and exactly one candidate.
- **`ambiguous`:** several candidates. Nothing is guessed.
- **`unpaired`:** no candidate.

`index-summary.json` holds:
- the source size and mtime, plus `unchangedDuringScan`;
- signature, decode and rejection counts, with up to 20 rejected examples;
- records per channel;
- pairs, rates, the first and last timestamps;
- coverage against `poses.csv`.

**Extractor**

```bash
python3 scripts/xgrids/extract_frames.py rec.xbin --validation
python3 scripts/xgrids/extract_frames.py rec.xbin
```

It decodes chosen pairs to JPEG with interpolated scanner poses; see [scripts/xgrids/README.md](../../scripts/xgrids/README.md).

## 7. Verified and provisional

| | Status | Evidence |
|---|---|---|
| `XBAG` signature | verified for this file | offset 0 |
| Camera record header layout (length, count, first/last timestamp, channel, payload length ×2) | verified for camera records | all 2,918 match their messages exactly |
| Header bytes `01 00`, `24 00`, write time, the 4 trailing bytes | provisional | constant or plausible values; meaning unknown |
| Non-camera channels (0, 1, 3, 21) | unknown | headers parse; payloads not examined |
| Channels 14 and 18 are the two cameras | verified for this file | one image per sequence per channel; pairs within 213 µs |
| Which physical camera each channel is | unknown | `project.json` names `left_main` / `right_main` without a mapping |
| Image message fields 1–6 and the header fields | layout verified; meaning partly provisional | 14,590 / 14,590 decode exactly. Fields 3 and 4 = picture size (matches the decoded JPEGs). Header field 3, field 2 and field 6 are unknown |
| Sequence 0 omitted (proto3 default) | verified | both cameras' first images; they match their record header |
| Timestamps in µs since 1970 UTC, same clock as `poses.csv` | verified as consistent | record headers, monotonic sequences, overlap with poses. Exposure semantics unknown |
| Field 5 = complete, self-contained H.264 picture | verified for 490 decoded images | 484 + 6 images decode with no FFmpeg warning. The other images are checked by structure only |
| SPS signature finds every camera image | verified for this file only | declared camera messages = decoded images |
| Same layout in other recordings or firmware | **not tested** | |

## 8. Corrections to the early indexing experiments

The first exploratory script (64 MiB, outputs in `<recording>/reconstruction/xbin-investigation/`) found 116 frames and 56 pairs. The strict indexer finds 117 frames and 57 pairs in the same range. Corrections:

1. **Missed sequence-0 frames.** The experiment required the `08` sequence field, so it skipped the frame at SPS offset 2,325,090 (sequence 0, channel 14) and with it the sequence-0 pair. Sequence 0 is simply omitted (proto3 default).
2. **Wrong metadata for the first frame.** The experiment reported sequence 1086 / timestamp …217.574699 for the first image, read from bytes outside that image's message. The correct values are sequence 0 / …216.490409, which equals its record header's first timestamp. The other 115 timestamps were already identical.
3. **Image boundaries.** "SPS to next SPS" is not an image: images end at the declared field-5 length. Record boundaries, once unknown, are now identified (section 2).
4. **Pair time differences.** The early figure of 0.004–0.019 ms (4–19 µs) held for the first 64 MiB only. Over the whole file the median is 17 µs and the maximum 213 µs.
5. **64 MiB edge effects.** At the 64 MiB cut-off, 3 unpaired and 2 unlabelled frames remain only because their partners or records lie past the cut. The full scan has 0 unpaired.

Two later corrections were made to our own tools in Lab 13Q:

6. **Missed decoder warnings.** FFmpeg at `-loglevel error` stays silent for a frame with damaged slice data: it conceals the damage, warns "corrupt decoded frame" and exits 0. The extractor therefore logs at `warning` level, and any message marks the image `decoded-with-errors`.
7. **Approximate SLERP.** A "nearly identical" shortcut (`dot > 0.9995`, i.e. under about 3.6°) replaced SLERP with a normalised linear blend for almost every 100 ms pose step (median 1.2°), an error of up to 3·10⁻⁷. SLERP is now exact down to 10⁻⁶ rad, using `θ = 2·atan2(|q0 − q1|, |q0 + q1|)`.

## 9. Using a new recording

1. Run the indexer on the first 64 MiB, and again with `--chunk-mib 0.00390625` (4 KiB chunks). The two `frames.csv` files must be byte-identical.
2. Read `rejectionReasons`, `streamAssignment` and `xbagBatches` in `index-summary.json`:
   - Rejections or unlabelled frames mean the layout differs. Inspect them; don't relax the checks.
   - Compare `cameraMessagesDeclared` with `decodedFrames`. A shortfall means some images start with a different SPS.
3. Check that the channel IDs, sequence ranges, picture size and pairing statistics resemble those above. Record the firmware from `project.json`.
4. Extract a `--validation` set and inspect it before any larger extraction.
5. Add the recording's facts to [investigation-log.md](investigation-log.md). Then add the new case to the synthetic tests in `tests/xgrids/` if the layout differs.
