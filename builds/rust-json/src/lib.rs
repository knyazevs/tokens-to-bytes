#![no_std]

use core::arch::wasm32::unreachable;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    unreachable()
}

const CAP: usize = 65536;
const ROOT_CAP: usize = 4096;
const MAX_DEPTH: i32 = 64;

static mut INPUT: [u8; CAP] = [0; CAP];
static mut ROOTBUF: [u8; ROOT_CAP] = [0; ROOT_CAP];

static mut POS: i32 = 0;
static mut LEN: i32 = 0;
static mut ERR_CODE: i32 = 0;
static mut ERR_POS: i32 = 0;
static mut ROOT_TYPE: i32 = 0;
static mut ROOT_LEN: i32 = 0;
static mut ROOT_NUMBER: f64 = 0.0;
static mut NODES: i32 = 0;
static mut DEPTH_MAX: i32 = 0;
static mut NUMBERS: i32 = 0;
static mut STRINGS: i32 = 0;
static mut STRING_BYTES: i32 = 0;

unsafe fn fail(code: i32, at: i32) -> bool {
    ERR_CODE = code;
    ERR_POS = at;
    false
}

unsafe fn skip_ws() {
    while POS < LEN {
        let c = INPUT[POS as usize];
        if c != b' ' && c != b'\t' && c != b'\n' && c != b'\r' {
            break;
        }
        POS += 1;
    }
}

fn pow10i(e: i32) -> f64 {
    let mut r = 1.0;
    let mut n = e;
    while n > 0 {
        r *= 10.0;
        n -= 1;
    }
    r
}

unsafe fn store_byte(store: bool, outlen: i32, b: u8) -> bool {
    if store {
        if outlen >= ROOT_CAP as i32 {
            return false;
        }
        ROOTBUF[outlen as usize] = b;
    }
    true
}

unsafe fn emit_cp(store: bool, outlen: &mut i32, cp: i32) -> bool {
    if cp < 0x80 {
        if !store_byte(store, *outlen, cp as u8) {
            return false;
        }
        *outlen += 1;
    } else if cp < 0x800 {
        if !store_byte(store, *outlen, (0xC0 | (cp >> 6)) as u8) {
            return false;
        }
        if !store_byte(store, *outlen + 1, (0x80 | (cp & 0x3F)) as u8) {
            return false;
        }
        *outlen += 2;
    } else if cp < 0x10000 {
        if !store_byte(store, *outlen, (0xE0 | (cp >> 12)) as u8) {
            return false;
        }
        if !store_byte(store, *outlen + 1, (0x80 | ((cp >> 6) & 0x3F)) as u8) {
            return false;
        }
        if !store_byte(store, *outlen + 2, (0x80 | (cp & 0x3F)) as u8) {
            return false;
        }
        *outlen += 3;
    } else {
        if !store_byte(store, *outlen, (0xF0 | (cp >> 18)) as u8) {
            return false;
        }
        if !store_byte(store, *outlen + 1, (0x80 | ((cp >> 12) & 0x3F)) as u8) {
            return false;
        }
        if !store_byte(store, *outlen + 2, (0x80 | ((cp >> 6) & 0x3F)) as u8) {
            return false;
        }
        if !store_byte(store, *outlen + 3, (0x80 | (cp & 0x3F)) as u8) {
            return false;
        }
        *outlen += 4;
    }
    true
}

unsafe fn hex4(at: i32, out: &mut i32) -> bool {
    let mut v = 0;
    let mut i = 0;
    while i < 4 {
        if POS >= LEN {
            return fail(6, at);
        }
        let c = INPUT[POS as usize];
        POS += 1;
        let d = if c >= b'0' && c <= b'9' {
            (c - b'0') as i32
        } else if c >= b'a' && c <= b'f' {
            (c - b'a') as i32 + 10
        } else if c >= b'A' && c <= b'F' {
            (c - b'A') as i32 + 10
        } else {
            return fail(6, at);
        };
        v = (v << 4) | d;
        i += 1;
    }
    *out = v;
    true
}

unsafe fn parse_string(is_key: bool, depth: i32) -> bool {
    let start = POS;
    POS += 1;
    let mut outlen = 0;
    let store = !is_key && depth == 1;

    loop {
        if POS >= LEN {
            return fail(2, LEN);
        }
        let c = INPUT[POS as usize];
        if c == b'"' {
            POS += 1;
            if store {
                ROOT_LEN = outlen;
            }
            STRINGS += 1;
            STRING_BYTES += outlen;
            return true;
        }
        if c < 0x20 {
            return fail(6, POS);
        }
        if c == b'\\' {
            let esc = POS;
            POS += 1;
            if POS >= LEN {
                return fail(2, LEN);
            }
            let e = INPUT[POS as usize];
            POS += 1;
            let cp;
            if e == b'"' || e == b'\\' || e == b'/' {
                cp = e as i32;
            } else if e == b'b' {
                cp = 8;
            } else if e == b'f' {
                cp = 12;
            } else if e == b'n' {
                cp = 10;
            } else if e == b'r' {
                cp = 13;
            } else if e == b't' {
                cp = 9;
            } else if e == b'u' {
                let mut hi = 0;
                if !hex4(esc, &mut hi) {
                    return false;
                }
                if hi >= 0xD800 && hi <= 0xDBFF {
                    if POS + 1 >= LEN || INPUT[POS as usize] != b'\\' || INPUT[(POS + 1) as usize] != b'u' {
                        return fail(6, esc);
                    }
                    POS += 2;
                    let mut lo = 0;
                    if !hex4(esc, &mut lo) {
                        return false;
                    }
                    if lo < 0xDC00 || lo > 0xDFFF {
                        return fail(6, esc);
                    }
                    cp = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
                } else if hi >= 0xDC00 && hi <= 0xDFFF {
                    return fail(6, esc);
                } else {
                    cp = hi;
                }
            } else {
                return fail(6, esc);
            }
            if !emit_cp(store, &mut outlen, cp) {
                return fail(8, start);
            }
        } else {
            if !store_byte(store, outlen, c) {
                return fail(8, start);
            }
            outlen += 1;
            POS += 1;
        }
    }
}

unsafe fn parse_number(depth: i32, _start: i32) -> bool {
    let mut neg = false;
    if INPUT[POS as usize] == b'-' {
        neg = true;
        POS += 1;
        if POS >= LEN {
            return fail(2, LEN);
        }
    }
    if POS >= LEN {
        return fail(2, LEN);
    }

    let mut value = 0.0;
    let c = INPUT[POS as usize];
    if c == b'0' {
        POS += 1;
        if POS < LEN && INPUT[POS as usize] >= b'0' && INPUT[POS as usize] <= b'9' {
            return fail(5, POS);
        }
    } else if c >= b'1' && c <= b'9' {
        while POS < LEN && INPUT[POS as usize] >= b'0' && INPUT[POS as usize] <= b'9' {
            value = value * 10.0 + (INPUT[POS as usize] - b'0') as f64;
            POS += 1;
        }
    } else {
        return fail(5, POS);
    }

    if POS < LEN && INPUT[POS as usize] == b'.' {
        POS += 1;
        if POS >= LEN || INPUT[POS as usize] < b'0' || INPUT[POS as usize] > b'9' {
            return fail(5, if POS > LEN { LEN } else { POS });
        }
        let mut scale = 0.1;
        while POS < LEN && INPUT[POS as usize] >= b'0' && INPUT[POS as usize] <= b'9' {
            value += (INPUT[POS as usize] - b'0') as f64 * scale;
            scale *= 0.1;
            POS += 1;
        }
    }

    if POS < LEN && (INPUT[POS as usize] == b'e' || INPUT[POS as usize] == b'E') {
        POS += 1;
        let mut eneg = false;
        if POS < LEN && (INPUT[POS as usize] == b'+' || INPUT[POS as usize] == b'-') {
            eneg = INPUT[POS as usize] == b'-';
            POS += 1;
        }
        if POS >= LEN || INPUT[POS as usize] < b'0' || INPUT[POS as usize] > b'9' {
            return fail(5, if POS > LEN { LEN } else { POS });
        }
        let mut exp = 0;
        while POS < LEN && INPUT[POS as usize] >= b'0' && INPUT[POS as usize] <= b'9' {
            if exp < 10000 {
                exp = exp * 10 + (INPUT[POS as usize] - b'0') as i32;
            }
            POS += 1;
        }
        let p = pow10i(exp);
        if eneg {
            value /= p;
        } else {
            value *= p;
        }
    }

    if neg {
        value = -value;
    }
    NUMBERS += 1;
    if depth == 1 {
        ROOT_TYPE = 3;
        ROOT_NUMBER = value;
    }
    true
}

unsafe fn parse_array(depth: i32) -> bool {
    POS += 1;
    skip_ws();
    if POS < LEN && INPUT[POS as usize] == b']' {
        POS += 1;
        if depth == 1 {
            ROOT_LEN = 0;
        }
        return true;
    }
    let mut count = 0;
    loop {
        count += 1;
        if !parse_value(depth + 1) {
            return false;
        }
        skip_ws();
        if POS >= LEN {
            return fail(2, LEN);
        }
        if INPUT[POS as usize] == b',' {
            POS += 1;
            skip_ws();
            if POS >= LEN {
                return fail(2, LEN);
            }
            if INPUT[POS as usize] == b']' {
                return fail(1, POS);
            }
            continue;
        }
        if INPUT[POS as usize] == b']' {
            POS += 1;
            break;
        }
        return fail(1, POS);
    }
    if depth == 1 {
        ROOT_LEN = count;
    }
    true
}

unsafe fn parse_object(depth: i32) -> bool {
    POS += 1;
    skip_ws();
    if POS < LEN && INPUT[POS as usize] == b'}' {
        POS += 1;
        if depth == 1 {
            ROOT_LEN = 0;
        }
        return true;
    }
    let mut count = 0;
    loop {
        skip_ws();
        if POS >= LEN {
            return fail(2, LEN);
        }
        if INPUT[POS as usize] != b'"' {
            return fail(1, POS);
        }
        if !parse_string(true, depth) {
            return false;
        }
        skip_ws();
        if POS >= LEN {
            return fail(2, LEN);
        }
        if INPUT[POS as usize] != b':' {
            return fail(1, POS);
        }
        POS += 1;
        count += 1;
        if !parse_value(depth + 1) {
            return false;
        }
        skip_ws();
        if POS >= LEN {
            return fail(2, LEN);
        }
        if INPUT[POS as usize] == b',' {
            POS += 1;
            skip_ws();
            if POS >= LEN {
                return fail(2, LEN);
            }
            if INPUT[POS as usize] == b'}' {
                return fail(1, POS);
            }
            continue;
        }
        if INPUT[POS as usize] == b'}' {
            POS += 1;
            break;
        }
        return fail(1, POS);
    }
    if depth == 1 {
        ROOT_LEN = count;
    }
    true
}

unsafe fn parse_value(depth: i32) -> bool {
    if depth > MAX_DEPTH {
        return fail(4, POS);
    }
    if depth > DEPTH_MAX {
        DEPTH_MAX = depth;
    }
    skip_ws();
    if POS >= LEN {
        return fail(2, LEN);
    }

    let c = INPUT[POS as usize];
    let start = POS;
    NODES += 1;

    if c == b'{' {
        if depth == 1 {
            ROOT_TYPE = 6;
        }
        return parse_object(depth);
    }
    if c == b'[' {
        if depth == 1 {
            ROOT_TYPE = 5;
        }
        return parse_array(depth);
    }
    if c == b'"' {
        if depth == 1 {
            ROOT_TYPE = 4;
        }
        return parse_string(false, depth);
    }
    if c == b't' {
        if POS + 4 <= LEN
            && INPUT[(POS + 1) as usize] == b'r'
            && INPUT[(POS + 2) as usize] == b'u'
            && INPUT[(POS + 3) as usize] == b'e'
        {
            POS += 4;
            if depth == 1 {
                ROOT_TYPE = 2;
            }
            return true;
        }
        return fail(1, start);
    }
    if c == b'f' {
        if POS + 5 <= LEN
            && INPUT[(POS + 1) as usize] == b'a'
            && INPUT[(POS + 2) as usize] == b'l'
            && INPUT[(POS + 3) as usize] == b's'
            && INPUT[(POS + 4) as usize] == b'e'
        {
            POS += 5;
            if depth == 1 {
                ROOT_TYPE = 1;
            }
            return true;
        }
        return fail(1, start);
    }
    if c == b'n' {
        if POS + 4 <= LEN
            && INPUT[(POS + 1) as usize] == b'u'
            && INPUT[(POS + 2) as usize] == b'l'
            && INPUT[(POS + 3) as usize] == b'l'
        {
            POS += 4;
            if depth == 1 {
                ROOT_TYPE = 0;
            }
            return true;
        }
        return fail(1, start);
    }
    if c == b'-' || (c >= b'0' && c <= b'9') {
        return parse_number(depth, start);
    }
    fail(1, POS)
}

unsafe fn parse(n: i32) -> i32 {
    ERR_CODE = 0;
    ERR_POS = 0;
    ROOT_TYPE = 0;
    ROOT_LEN = 0;
    ROOT_NUMBER = 0.0;
    NODES = 0;
    DEPTH_MAX = 0;
    NUMBERS = 0;
    STRINGS = 0;
    STRING_BYTES = 0;

    if n < 0 || n as usize > CAP {
        ERR_CODE = 8;
        ERR_POS = 0;
        return 8;
    }

    POS = 0;
    LEN = n;

    if !parse_value(1) {
        return ERR_CODE;
    }
    skip_ws();
    if POS != LEN {
        fail(3, POS);
        return ERR_CODE;
    }
    0
}

#[no_mangle]
pub extern "C" fn json_input_ptr() -> i32 {
    unsafe { INPUT.as_ptr() as i32 }
}

#[no_mangle]
pub extern "C" fn json_parse(n: i32) -> i32 {
    unsafe { parse(n) }
}

#[no_mangle]
pub extern "C" fn json_error_pos() -> i32 {
    unsafe { ERR_POS }
}

#[no_mangle]
pub extern "C" fn json_error_code() -> i32 {
    unsafe { ERR_CODE }
}

#[no_mangle]
pub extern "C" fn json_root_type() -> i32 {
    unsafe { ROOT_TYPE }
}

#[no_mangle]
pub extern "C" fn json_root_number() -> f64 {
    unsafe { ROOT_NUMBER }
}

#[no_mangle]
pub extern "C" fn json_root_len() -> i32 {
    unsafe { ROOT_LEN }
}

#[no_mangle]
pub extern "C" fn json_root_ptr() -> i32 {
    unsafe { ROOTBUF.as_ptr() as i32 }
}

#[no_mangle]
pub extern "C" fn json_nodes() -> i32 {
    unsafe { NODES }
}

#[no_mangle]
pub extern "C" fn json_depth() -> i32 {
    unsafe { DEPTH_MAX }
}

#[no_mangle]
pub extern "C" fn json_numbers() -> i32 {
    unsafe { NUMBERS }
}

#[no_mangle]
pub extern "C" fn json_strings() -> i32 {
    unsafe { STRINGS }
}

#[no_mangle]
pub extern "C" fn json_string_bytes() -> i32 {
    unsafe { STRING_BYTES }
}
