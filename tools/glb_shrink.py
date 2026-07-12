#!/usr/bin/env python3
"""Downscale embedded textures of a GLB to <= MAX px, repacking the binary
chunk in place. ONLY touches image bytes + bufferView offsets/lengths, geometry,
materials, their names and order are copied verbatim, so the output loads in a
plain GLTFLoader with all spec-gloss / materialColors lookups intact."""
import io
import json
import struct
import sys

from PIL import Image

JSON_CHUNK, BIN_CHUNK, GLB_MAGIC = 0x4E4F534A, 0x004E4942, 0x46546C67


def read_glb(path):
    d = open(path, 'rb').read()
    magic, ver, length = struct.unpack('<III', d[:12])
    assert magic == GLB_MAGIC, "not a GLB"
    off, js, binc = 12, None, b''
    while off < length:
        clen, ctype = struct.unpack('<II', d[off:off+8])
        off += 8
        chunk = d[off:off+clen]
        off += clen
        if ctype == JSON_CHUNK:
            js = json.loads(chunk.decode('utf-8'))
        elif ctype == BIN_CHUNK:
            binc = chunk
    return js, binc


def resize_image(data, mime, max_dim):
    im = Image.open(io.BytesIO(data))
    w, h = im.size
    if max(w, h) <= max_dim:
        return None
    s = max_dim / max(w, h)
    im = im.resize((max(1, round(w*s)), max(1, round(h*s))), Image.LANCZOS)
    out = io.BytesIO()
    if 'jpeg' in mime or 'jpg' in mime:
        im.convert('RGB').save(out, format='JPEG', quality=90)
    else:
        im.save(out, format='PNG', optimize=True)
    return out.getvalue()


def shrink(path, out_path, max_dim=1024):
    js, binc = read_glb(path)
    assert len(js.get('buffers', [])) == 1 and 'uri' not in js['buffers'][0], \
        "expected a single embedded GLB buffer"
    bvs = js['bufferViews']
    new_bytes = {}
    for im in js.get('images', []):
        if 'bufferView' not in im:
            continue
        bvi = im['bufferView']
        bv = bvs[bvi]
        offset, chunk_length = bv.get('byteOffset', 0), bv['byteLength']
        r = resize_image(
            binc[offset:offset+chunk_length],
            im.get('mimeType', 'image/png'),
            max_dim,
        )
        if r is not None:
            new_bytes[bvi] = r
    if not new_bytes:
        return None
    # rebuild BIN: every bufferView kept in index order, 4-byte aligned start
    new_bin = bytearray()
    for i, bv in enumerate(bvs):
        data = new_bytes.get(i)
        if data is None:
            offset, chunk_length = bv.get('byteOffset', 0), bv['byteLength']
            data = binc[offset:offset+chunk_length]
        while len(new_bin) % 4:
            new_bin.append(0)
        bv['byteOffset'] = len(new_bin)
        bv['byteLength'] = len(data)
        new_bin += data
    while len(new_bin) % 4:
        new_bin.append(0)
    js['buffers'][0]['byteLength'] = len(new_bin)
    json_bytes = json.dumps(js, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * ((-len(json_bytes)) % 4)
    bin_bytes = bytes(new_bin)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(out_path, 'wb') as f:
        f.write(struct.pack('<III', GLB_MAGIC, 2, total))
        f.write(struct.pack('<II', len(json_bytes), JSON_CHUNK))
        f.write(json_bytes)
        f.write(struct.pack('<II', len(bin_bytes), BIN_CHUNK))
        f.write(bin_bytes)
    return out_path


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    r = shrink(src, dst)
    print(("resized -> " + r) if r else "no oversized textures, skipped")
