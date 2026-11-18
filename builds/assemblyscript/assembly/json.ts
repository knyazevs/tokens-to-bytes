const CAP: i32 = 65536;
const ROOT_CAP: i32 = 4096;
const MAX_DEPTH: i32 = 64;

// Буферы лежат по фиксированным адресам в линейной памяти: без аллокатора,
// без Array и без импортов окружения. Это делает сборку сопоставимой с WAT.
const INPUT_PTR: i32 = 0x10000;
const ROOT_PTR: i32 = 0x20000;

function ensureMemory(): void {
  if (memory.size() < 4) memory.grow(4 - memory.size());
}

ensureMemory();

let pos: i32 = 0;
let len: i32 = 0;
let errCode: i32 = 0;
let errPos: i32 = 0;
let rootType: i32 = 0;
let rootLen: i32 = 0;
let rootNumber: f64 = 0.0;
let nodes: i32 = 0;
let depthMax: i32 = 0;
let numbers: i32 = 0;
let strings: i32 = 0;
let stringBytes: i32 = 0;

function byteAt(i: i32): u8 {
  return load<u8>(INPUT_PTR + i);
}

function fail(code: i32, at: i32): bool {
  errCode = code;
  errPos = at;
  return false;
}

function skipWs(): void {
  while (pos < len) {
    let c = byteAt(pos);
    if (c != 0x20 && c != 0x09 && c != 0x0A && c != 0x0D) break;
    pos += 1;
  }
}

function pow10i(e: i32): f64 {
  let r: f64 = 1.0;
  let n = e;
  while (n > 0) {
    r *= 10.0;
    n -= 1;
  }
  return r;
}

function storeByte(keep: bool, outlen: i32, b: u8): bool {
  if (keep) {
    if (outlen >= ROOT_CAP) return false;
    store<u8>(ROOT_PTR + outlen, b);
  }
  return true;
}

function emitCp(keep: bool, outlen: i32, cp: i32): i32 {
  if (cp < 0x80) {
    if (!storeByte(keep, outlen, <u8>cp)) return -1;
    return outlen + 1;
  }
  if (cp < 0x800) {
    if (!storeByte(keep, outlen, <u8>(0xC0 | (cp >> 6)))) return -1;
    if (!storeByte(keep, outlen + 1, <u8>(0x80 | (cp & 0x3F)))) return -1;
    return outlen + 2;
  }
  if (cp < 0x10000) {
    if (!storeByte(keep, outlen, <u8>(0xE0 | (cp >> 12)))) return -1;
    if (!storeByte(keep, outlen + 1, <u8>(0x80 | ((cp >> 6) & 0x3F)))) return -1;
    if (!storeByte(keep, outlen + 2, <u8>(0x80 | (cp & 0x3F)))) return -1;
    return outlen + 3;
  }
  if (!storeByte(keep, outlen, <u8>(0xF0 | (cp >> 18)))) return -1;
  if (!storeByte(keep, outlen + 1, <u8>(0x80 | ((cp >> 12) & 0x3F)))) return -1;
  if (!storeByte(keep, outlen + 2, <u8>(0x80 | ((cp >> 6) & 0x3F)))) return -1;
  if (!storeByte(keep, outlen + 3, <u8>(0x80 | (cp & 0x3F)))) return -1;
  return outlen + 4;
}

function hex4(at: i32): i32 {
  let v = 0;
  for (let i = 0; i < 4; i++) {
    if (pos >= len) {
      fail(6, at);
      return -1;
    }
    let c = byteAt(pos);
    pos += 1;
    let d = 0;
    if (c >= 0x30 && c <= 0x39) d = c - 0x30;
    else if (c >= 0x61 && c <= 0x66) d = c - 0x61 + 10;
    else if (c >= 0x41 && c <= 0x46) d = c - 0x41 + 10;
    else {
      fail(6, at);
      return -1;
    }
    v = (v << 4) | d;
  }
  return v;
}

function parseString(isKey: bool, depth: i32): bool {
  let start = pos;
  pos += 1;
  let outlen = 0;
  let store = !isKey && depth == 1;

  while (true) {
    if (pos >= len) return fail(2, len);
    let c = byteAt(pos);
    if (c == 0x22) {
      pos += 1;
      if (store) rootLen = outlen;
      strings += 1;
      stringBytes += outlen;
      return true;
    }
    if (c < 0x20) return fail(6, pos);
    if (c == 0x5C) {
      let esc = pos;
      pos += 1;
      if (pos >= len) return fail(2, len);
      let e = byteAt(pos);
      pos += 1;
      let cp = 0;
      if (e == 0x22 || e == 0x5C || e == 0x2F) cp = e;
      else if (e == 0x62) cp = 8;
      else if (e == 0x66) cp = 12;
      else if (e == 0x6E) cp = 10;
      else if (e == 0x72) cp = 13;
      else if (e == 0x74) cp = 9;
      else if (e == 0x75) {
        let hi = hex4(esc);
        if (hi < 0) return false;
        if (hi >= 0xD800 && hi <= 0xDBFF) {
          if (pos + 1 >= len || byteAt(pos) != 0x5C || byteAt(pos + 1) != 0x75) return fail(6, esc);
          pos += 2;
          let lo = hex4(esc);
          if (lo < 0) return false;
          if (lo < 0xDC00 || lo > 0xDFFF) return fail(6, esc);
          cp = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
        } else if (hi >= 0xDC00 && hi <= 0xDFFF) {
          return fail(6, esc);
        } else {
          cp = hi;
        }
      } else {
        return fail(6, esc);
      }
      let next = emitCp(store, outlen, cp);
      if (next < 0) return fail(8, start);
      outlen = next;
    } else {
      if (!storeByte(store, outlen, c)) return fail(8, start);
      outlen += 1;
      pos += 1;
    }
  }
  return false;
}

function parseNumber(depth: i32): bool {
  let neg = false;
  if (byteAt(pos) == 0x2D) {
    neg = true;
    pos += 1;
    if (pos >= len) return fail(2, len);
  }
  if (pos >= len) return fail(2, len);

  let value: f64 = 0.0;
  let c = byteAt(pos);
  if (c == 0x30) {
    pos += 1;
    if (pos < len && byteAt(pos) >= 0x30 && byteAt(pos) <= 0x39) return fail(5, pos);
  } else if (c >= 0x31 && c <= 0x39) {
    while (pos < len && byteAt(pos) >= 0x30 && byteAt(pos) <= 0x39) {
      value = value * 10.0 + <f64>(byteAt(pos) - 0x30);
      pos += 1;
    }
  } else {
    return fail(5, pos);
  }

  if (pos < len && byteAt(pos) == 0x2E) {
    pos += 1;
    if (pos >= len || byteAt(pos) < 0x30 || byteAt(pos) > 0x39) return fail(5, pos > len ? len : pos);
    let scale: f64 = 0.1;
    while (pos < len && byteAt(pos) >= 0x30 && byteAt(pos) <= 0x39) {
      value += <f64>(byteAt(pos) - 0x30) * scale;
      scale *= 0.1;
      pos += 1;
    }
  }

  if (pos < len && (byteAt(pos) == 0x65 || byteAt(pos) == 0x45)) {
    pos += 1;
    let eneg = false;
    if (pos < len && (byteAt(pos) == 0x2B || byteAt(pos) == 0x2D)) {
      eneg = byteAt(pos) == 0x2D;
      pos += 1;
    }
    if (pos >= len || byteAt(pos) < 0x30 || byteAt(pos) > 0x39) return fail(5, pos > len ? len : pos);
    let exp = 0;
    while (pos < len && byteAt(pos) >= 0x30 && byteAt(pos) <= 0x39) {
      if (exp < 10000) exp = exp * 10 + (byteAt(pos) - 0x30);
      pos += 1;
    }
    let p = pow10i(exp);
    if (eneg) value /= p;
    else value *= p;
  }

  if (neg) value = -value;
  numbers += 1;
  if (depth == 1) {
    rootType = 3;
    rootNumber = value;
  }
  return true;
}

function parseArray(depth: i32): bool {
  pos += 1;
  skipWs();
  if (pos < len && byteAt(pos) == 0x5D) {
    pos += 1;
    if (depth == 1) rootLen = 0;
    return true;
  }
  let count = 0;
  while (true) {
    count += 1;
    if (!parseValue(depth + 1)) return false;
    skipWs();
    if (pos >= len) return fail(2, len);
    if (byteAt(pos) == 0x2C) {
      pos += 1;
      skipWs();
      if (pos >= len) return fail(2, len);
      if (byteAt(pos) == 0x5D) return fail(1, pos);
      continue;
    }
    if (byteAt(pos) == 0x5D) {
      pos += 1;
      break;
    }
    return fail(1, pos);
  }
  if (depth == 1) rootLen = count;
  return true;
}

function parseObject(depth: i32): bool {
  pos += 1;
  skipWs();
  if (pos < len && byteAt(pos) == 0x7D) {
    pos += 1;
    if (depth == 1) rootLen = 0;
    return true;
  }
  let count = 0;
  while (true) {
    skipWs();
    if (pos >= len) return fail(2, len);
    if (byteAt(pos) != 0x22) return fail(1, pos);
    if (!parseString(true, depth)) return false;
    skipWs();
    if (pos >= len) return fail(2, len);
    if (byteAt(pos) != 0x3A) return fail(1, pos);
    pos += 1;
    count += 1;
    if (!parseValue(depth + 1)) return false;
    skipWs();
    if (pos >= len) return fail(2, len);
    if (byteAt(pos) == 0x2C) {
      pos += 1;
      skipWs();
      if (pos >= len) return fail(2, len);
      if (byteAt(pos) == 0x7D) return fail(1, pos);
      continue;
    }
    if (byteAt(pos) == 0x7D) {
      pos += 1;
      break;
    }
    return fail(1, pos);
  }
  if (depth == 1) rootLen = count;
  return true;
}

function parseValue(depth: i32): bool {
  if (depth > MAX_DEPTH) return fail(4, pos);
  if (depth > depthMax) depthMax = depth;
  skipWs();
  if (pos >= len) return fail(2, len);

  let c = byteAt(pos);
  let start = pos;
  nodes += 1;

  if (c == 0x7B) {
    if (depth == 1) rootType = 6;
    return parseObject(depth);
  }
  if (c == 0x5B) {
    if (depth == 1) rootType = 5;
    return parseArray(depth);
  }
  if (c == 0x22) {
    if (depth == 1) rootType = 4;
    return parseString(false, depth);
  }
  if (c == 0x74) {
    if (pos + 4 <= len && byteAt(pos + 1) == 0x72 && byteAt(pos + 2) == 0x75 && byteAt(pos + 3) == 0x65) {
      pos += 4;
      if (depth == 1) rootType = 2;
      return true;
    }
    return fail(1, start);
  }
  if (c == 0x66) {
    if (pos + 5 <= len && byteAt(pos + 1) == 0x61 && byteAt(pos + 2) == 0x6C && byteAt(pos + 3) == 0x73 && byteAt(pos + 4) == 0x65) {
      pos += 5;
      if (depth == 1) rootType = 1;
      return true;
    }
    return fail(1, start);
  }
  if (c == 0x6E) {
    if (pos + 4 <= len && byteAt(pos + 1) == 0x75 && byteAt(pos + 2) == 0x6C && byteAt(pos + 3) == 0x6C) {
      pos += 4;
      if (depth == 1) rootType = 0;
      return true;
    }
    return fail(1, start);
  }
  if (c == 0x2D || (c >= 0x30 && c <= 0x39)) {
    return parseNumber(depth);
  }
  return fail(1, pos);
}

export function json_input_ptr(): i32 {
  ensureMemory();
  return INPUT_PTR;
}

export function json_parse(n: i32): i32 {
  ensureMemory();
  errCode = 0;
  errPos = 0;
  rootType = 0;
  rootLen = 0;
  rootNumber = 0.0;
  nodes = 0;
  depthMax = 0;
  numbers = 0;
  strings = 0;
  stringBytes = 0;

  if (n < 0 || n > CAP) {
    errCode = 8;
    errPos = 0;
    return 8;
  }

  pos = 0;
  len = n;

  if (!parseValue(1)) return errCode;
  skipWs();
  if (pos != len) {
    fail(3, pos);
    return errCode;
  }
  return 0;
}

export function json_error_pos(): i32 { return errPos; }
export function json_error_code(): i32 { return errCode; }
export function json_root_type(): i32 { return rootType; }
export function json_root_number(): f64 { return rootNumber; }
export function json_root_len(): i32 { return rootLen; }
export function json_root_ptr(): i32 { ensureMemory(); return ROOT_PTR; }
export function json_nodes(): i32 { return nodes; }
export function json_depth(): i32 { return depthMax; }
export function json_numbers(): i32 { return numbers; }
export function json_strings(): i32 { return strings; }
export function json_string_bytes(): i32 { return stringBytes; }
