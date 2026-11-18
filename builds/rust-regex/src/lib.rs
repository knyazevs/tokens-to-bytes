// Regex-движок: компиляция в байткод и бэктрекинг-VM.
// Тот же контракт, что у C-референса: pattern/text в статических буферах,
// re_compile один раз, затем re_match сколько угодно раз.

#![no_std]

use core::arch::wasm32::unreachable;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    unreachable()
}

const PATTERN_CAP: usize = 4096;
const TEXT_CAP: usize = 8192;
const PROG_CAP: usize = 2048;
const CLASS_CAP: usize = 64;
const STACK_CAP: usize = 8192;
const STEP_CAP: i32 = 1_000_000;

const OP_CHAR: i32 = 1;
const OP_ANY: i32 = 2;
const OP_CLASS: i32 = 3;
const OP_BOL: i32 = 4;
const OP_EOL: i32 = 5;
const OP_JMP: i32 = 6;
const OP_SPLIT: i32 = 7;
const OP_MATCH: i32 = 8;

const ERR_CHAR: i32 = 1;
const ERR_UNMATCHED_OPEN: i32 = 2;
const ERR_UNMATCHED_CLOSE: i32 = 3;
const ERR_CLASS: i32 = 4;
const ERR_ESCAPE: i32 = 5;
const ERR_PROGRAM: i32 = 6;
const ERR_QUANT: i32 = 7;
const ERR_STEPS: i32 = 8;
const ERR_PATTERN_LEN: i32 = 9;
const ERR_TEXT_LEN: i32 = 10;
const ERR_NOT_COMPILED: i32 = 11;
const ERR_STACK: i32 = 12;

static mut PATTERN: [u8; PATTERN_CAP] = [0; PATTERN_CAP];
static mut TEXT: [u8; TEXT_CAP] = [0; TEXT_CAP];
static mut PROG: [i32; PROG_CAP * 4] = [0; PROG_CAP * 4];
static mut CLASSES: [u8; CLASS_CAP * 32] = [0; CLASS_CAP * 32];
static mut BT_PC: [i32; STACK_CAP] = [0; STACK_CAP];
static mut BT_POS: [i32; STACK_CAP] = [0; STACK_CAP];

static mut PAT_LEN: i32 = 0;
static mut PAT_POS: i32 = 0;
static mut PC: i32 = 0;
static mut CLASS_COUNT: i32 = 0;
static mut TEXT_LEN: i32 = 0;
static mut COMPILED: i32 = 0;
static mut ERR: i32 = 0;
static mut ERR_POS: i32 = 0;
static mut STEPS: i32 = 0;

unsafe fn fail(code: i32, pos: i32) {
    if ERR == 0 {
        ERR = code;
        ERR_POS = pos;
    }
}

unsafe fn pat_at(i: i32) -> i32 {
    if i >= 0 && i < PAT_LEN {
        PATTERN[i as usize] as i32
    } else {
        -1
    }
}

unsafe fn peek() -> i32 {
    pat_at(PAT_POS)
}

unsafe fn take() -> i32 {
    if PAT_POS >= PAT_LEN {
        return -1;
    }
    let c = PATTERN[PAT_POS as usize] as i32;
    PAT_POS += 1;
    c
}

unsafe fn take_if(c: i32) -> bool {
    if peek() == c {
        PAT_POS += 1;
        true
    } else {
        false
    }
}

unsafe fn class_add(cls: i32, lo: i32, hi: i32) {
    let mut lo = lo;
    let mut hi = hi;
    if lo < 0 {
        lo = 0;
    }
    if hi > 255 {
        hi = 255;
    }
    let mut c = lo;
    while c <= hi {
        let idx = (cls * 32 + (c >> 3)) as usize;
        CLASSES[idx] |= 1u8 << (c & 7);
        c += 1;
    }
}

unsafe fn class_new() -> i32 {
    if CLASS_COUNT >= CLASS_CAP as i32 {
        fail(ERR_PROGRAM, PAT_POS);
        return -1;
    }
    let cls = CLASS_COUNT;
    CLASS_COUNT += 1;
    let mut i = 0;
    while i < 32 {
        CLASSES[(cls * 32 + i) as usize] = 0;
        i += 1;
    }
    cls
}

// Возвращает (single, value). Для \d \w \s добавляет набор и single=false.
unsafe fn class_add_escape(cls: i32, e: i32) -> (bool, i32) {
    match e {
        100 => {
            // d
            class_add(cls, 48, 57);
            (false, 0)
        }
        119 => {
            // w
            class_add(cls, 48, 57);
            class_add(cls, 65, 90);
            class_add(cls, 95, 95);
            class_add(cls, 97, 122);
            (false, 0)
        }
        115 => {
            // s
            class_add(cls, 9, 13);
            class_add(cls, 32, 32);
            (false, 0)
        }
        _ => {
            let c = match e {
                110 => 10,
                116 => 9,
                114 => 13,
                102 => 12,
                118 => 11,
                _ => e,
            };
            (true, c)
        }
    }
}

unsafe fn scan_class_end(start: i32) -> i32 {
    let mut i = start + 1;
    while i < PAT_LEN {
        let c = PATTERN[i as usize] as i32;
        if c == 92 {
            i += 2;
            continue;
        }
        if c == 93 {
            return i + 1;
        }
        i += 1;
    }
    -1
}

unsafe fn scan_atom_end(start: i32) -> i32 {
    if start >= PAT_LEN {
        return -1;
    }
    let c = PATTERN[start as usize] as i32;
    if c == 91 {
        return scan_class_end(start);
    }
    if c == 92 {
        return if start + 2 <= PAT_LEN { start + 2 } else { -1 };
    }
    if c == 40 {
        let mut depth = 0;
        let mut i = start;
        while i < PAT_LEN {
            let d = PATTERN[i as usize] as i32;
            if d == 92 {
                i += 2;
                continue;
            }
            if d == 91 {
                i = scan_class_end(i);
                if i < 0 {
                    return -1;
                }
                continue;
            }
            if d == 40 {
                depth += 1;
            } else if d == 41 {
                depth -= 1;
                if depth == 0 {
                    return i + 1;
                }
            }
            i += 1;
        }
        return -1;
    }
    start + 1
}

unsafe fn parse_class() -> i32 {
    let start = PAT_POS;
    PAT_POS += 1;
    let neg = take_if(94); // ^
    let cls = class_new();
    if cls < 0 {
        return -1;
    }
    let mut items = 0;
    loop {
        let c = peek();
        if c < 0 {
            fail(ERR_CLASS, start);
            return -1;
        }
        if c == 93 {
            PAT_POS += 1;
            break;
        }
        let single;
        let mut escaped = false;
        let lo;
        let mut hi;
        if c == 92 {
            PAT_POS += 1;
            let e = take();
            if e < 0 {
                fail(ERR_ESCAPE, PAT_POS);
                return -1;
            }
            escaped = true;
            let (s, v) = class_add_escape(cls, e);
            single = s;
            lo = v;
            hi = v;
        } else {
            PAT_POS += 1;
            lo = c;
            hi = c;
            single = true;
        }
        if single && !escaped {
            if peek() == 45 && pat_at(PAT_POS + 1) != 93 && pat_at(PAT_POS + 1) >= 0 {
                PAT_POS += 1;
                let mut e = take();
                if e < 0 {
                    fail(ERR_ESCAPE, PAT_POS);
                    return -1;
                }
                if e == 92 {
                    e = take();
                    if e < 0 {
                        fail(ERR_ESCAPE, PAT_POS);
                        return -1;
                    }
                }
                hi = e;
                if hi < lo {
                    fail(ERR_CLASS, PAT_POS - 1);
                    return -1;
                }
            }
        }
        if single {
            class_add(cls, lo, hi);
        }
        items += 1;
    }
    if items == 0 {
        fail(ERR_CLASS, start);
        return -1;
    }
    if neg {
        let mut i = 0;
        while i < 32 {
            let idx = (cls * 32 + i) as usize;
            CLASSES[idx] = !CLASSES[idx];
            i += 1;
        }
    }
    cls
}

unsafe fn emit(op: i32, a: i32, b: i32) -> i32 {
    if PC >= PROG_CAP as i32 {
        fail(ERR_PROGRAM, PAT_POS);
        return -1;
    }
    let at = PC;
    PC += 1;
    PROG[(at * 4) as usize] = op;
    PROG[(at * 4 + 1) as usize] = a;
    PROG[(at * 4 + 2) as usize] = b;
    PROG[(at * 4 + 3) as usize] = 0;
    at
}

unsafe fn patch(at: i32, field: i32, value: i32) {
    PROG[(at * 4 + field) as usize] = value;
}

unsafe fn compile_atom() -> i32 {
    let c = peek();
    if c < 0 {
        fail(ERR_CHAR, PAT_POS);
        return -1;
    }
    if c == 40 {
        let start = PAT_POS;
        PAT_POS += 1;
        if compile_alt() < 0 {
            return -1;
        }
        if !take_if(41) {
            fail(ERR_UNMATCHED_OPEN, start);
            return -1;
        }
        return 1;
    }
    if c == 91 {
        let cls = parse_class();
        if cls < 0 {
            return -1;
        }
        return if emit(OP_CLASS, cls, 0) < 0 { -1 } else { 1 };
    }
    if c == 46 {
        PAT_POS += 1;
        return if emit(OP_ANY, 0, 0) < 0 { -1 } else { 1 };
    }
    if c == 94 {
        PAT_POS += 1;
        return if emit(OP_BOL, 0, 0) < 0 { -1 } else { 1 };
    }
    if c == 36 {
        PAT_POS += 1;
        return if emit(OP_EOL, 0, 0) < 0 { -1 } else { 1 };
    }
    if c == 92 {
        let start = PAT_POS;
        PAT_POS += 1;
        let mut e = take();
        if e < 0 {
            fail(ERR_ESCAPE, start);
            return -1;
        }
        if e == 100 || e == 119 || e == 115 {
            let cls = class_new();
            if cls < 0 {
                return -1;
            }
            if e == 100 {
                class_add(cls, 48, 57);
            } else if e == 119 {
                class_add(cls, 48, 57);
                class_add(cls, 65, 90);
                class_add(cls, 95, 95);
                class_add(cls, 97, 122);
            } else {
                class_add(cls, 9, 13);
                class_add(cls, 32, 32);
            }
            return if emit(OP_CLASS, cls, 0) < 0 { -1 } else { 1 };
        }
        e = match e {
            110 => 10,
            116 => 9,
            114 => 13,
            102 => 12,
            118 => 11,
            _ => e,
        };
        return if emit(OP_CHAR, e, 0) < 0 { -1 } else { 1 };
    }
    if c == 42 || c == 43 || c == 63 {
        fail(ERR_QUANT, PAT_POS);
        return -1;
    }
    PAT_POS += 1;
    if emit(OP_CHAR, c, 0) < 0 {
        -1
    } else {
        1
    }
}

fn is_quant(c: i32) -> bool {
    c == 42 || c == 43 || c == 63
}

// Есть ли на текущем уровне вложенности альтернатива `|`.
unsafe fn has_alt(from: i32) -> bool {
    let mut i = from;
    let mut depth = 0;
    while i < PAT_LEN {
        let c = PATTERN[i as usize] as i32;
        if c == 92 {
            i += 2;
            continue;
        }
        if c == 91 {
            i = scan_class_end(i);
            if i < 0 {
                return false;
            }
            continue;
        }
        if c == 40 {
            depth += 1;
            i += 1;
            continue;
        }
        if c == 41 {
            if depth == 0 {
                return false;
            }
            depth -= 1;
            i += 1;
            continue;
        }
        if c == 124 && depth == 0 {
            return true;
        }
        i += 1;
    }
    false
}

unsafe fn compile_seq() -> i32 {
    loop {
        let c = peek();
        if c < 0 || c == 124 || c == 41 {
            return 1;
        }
        let start = PAT_POS;
        let end = scan_atom_end(start);
        let mut q = if end > 0 { pat_at(end) } else { -1 };
        if !is_quant(q) {
            q = 0;
        }
        // Якоря не квантифицируются.
        if q != 0 && (c == 94 || c == 36) {
            fail(ERR_QUANT, end);
            return -1;
        }

        let mut split = -1;
        if q == 42 || q == 63 {
            split = emit(OP_SPLIT, PC + 1, 0);
            if split < 0 {
                return -1;
            }
        }
        let child = PC;
        if compile_atom() < 0 {
            return -1;
        }
        if q == 42 {
            if emit(OP_JMP, split, 0) < 0 {
                return -1;
            }
            patch(split, 2, PC);
        } else if q == 63 {
            patch(split, 2, PC);
        } else if q == 43 {
            split = emit(OP_SPLIT, child, 0);
            if split < 0 {
                return -1;
            }
            patch(split, 2, PC);
        }
        if q != 0 {
            PAT_POS += 1;
            if is_quant(peek()) {
                fail(ERR_QUANT, PAT_POS);
                return -1;
            }
        }
    }
}

unsafe fn compile_alt() -> i32 {
    if !has_alt(PAT_POS) {
        return compile_seq();
    }
    let split = emit(OP_SPLIT, PC + 1, 0);
    if split < 0 {
        return -1;
    }
    if compile_seq() < 0 {
        return -1;
    }
    if peek() == 124 {
        PAT_POS += 1;
        let jmp = emit(OP_JMP, 0, 0);
        if jmp < 0 {
            return -1;
        }
        patch(split, 2, PC);
        if compile_alt() < 0 {
            return -1;
        }
        patch(jmp, 1, PC);
    } else {
        patch(split, 2, PC);
    }
    1
}

unsafe fn class_has(cls: i32, c: i32) -> bool {
    let idx = (cls * 32 + (c >> 3)) as usize;
    ((CLASSES[idx] >> (c & 7)) & 1) != 0
}

#[no_mangle]
pub extern "C" fn re_pattern_ptr() -> *mut u8 {
    unsafe { PATTERN.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn re_text_ptr() -> *mut u8 {
    unsafe { TEXT.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn re_compile(len: i32) -> i32 {
    unsafe {
        ERR = 0;
        ERR_POS = 0;
        COMPILED = 0;
        PAT_POS = 0;
        PC = 0;
        CLASS_COUNT = 0;
        if len < 0 || len as usize > PATTERN_CAP {
            PAT_LEN = 0;
            fail(ERR_PATTERN_LEN, 0);
            return ERR;
        }
        PAT_LEN = len;
        let root = compile_alt();
        if root < 0 {
            return ERR;
        }
        if PAT_POS < PAT_LEN {
            if PATTERN[PAT_POS as usize] == 41 {
                fail(ERR_UNMATCHED_CLOSE, PAT_POS);
            } else {
                fail(ERR_CHAR, PAT_POS);
            }
            return ERR;
        }
        if emit(OP_MATCH, 0, 0) < 0 {
            return ERR;
        }
        COMPILED = 1;
        0
    }
}

#[no_mangle]
pub extern "C" fn re_match(len: i32) -> i32 {
    unsafe {
        ERR = 0;
        ERR_POS = 0;
        STEPS = 0;
        if COMPILED == 0 {
            fail(ERR_NOT_COMPILED, 0);
            return -1;
        }
        if len < 0 || len as usize > TEXT_CAP {
            fail(ERR_TEXT_LEN, 0);
            return -1;
        }
        TEXT_LEN = len;
        let mut start = 0;
        while start <= len {
            let mut ip = 0;
            let mut pos = start;
            let mut bt = 0;
            loop {
                STEPS += 1;
                if STEPS > STEP_CAP {
                    fail(ERR_STEPS, pos);
                    return -1;
                }
                let op = PROG[(ip * 4) as usize];
                let a = PROG[(ip * 4 + 1) as usize];
                let b = PROG[(ip * 4 + 2) as usize];
                let mut advanced = false;
                if op == OP_CHAR {
                    if pos < len && TEXT[pos as usize] as i32 == a {
                        pos += 1;
                        ip += 1;
                        advanced = true;
                    }
                } else if op == OP_ANY {
                    if pos < len && TEXT[pos as usize] != 10 {
                        pos += 1;
                        ip += 1;
                        advanced = true;
                    }
                } else if op == OP_CLASS {
                    if pos < len && class_has(a, TEXT[pos as usize] as i32) {
                        pos += 1;
                        ip += 1;
                        advanced = true;
                    }
                } else if op == OP_BOL {
                    if pos == 0 {
                        ip += 1;
                        advanced = true;
                    }
                } else if op == OP_EOL {
                    if pos == len {
                        ip += 1;
                        advanced = true;
                    }
                } else if op == OP_JMP {
                    ip = a;
                    advanced = true;
                } else if op == OP_SPLIT {
                    if bt >= STACK_CAP as i32 {
                        fail(ERR_STACK, pos);
                        return -1;
                    }
                    BT_PC[bt as usize] = b;
                    BT_POS[bt as usize] = pos;
                    bt += 1;
                    ip = a;
                    advanced = true;
                } else if op == OP_MATCH {
                    return 1;
                }
                if advanced {
                    continue;
                }
                if bt == 0 {
                    break;
                }
                bt -= 1;
                ip = BT_PC[bt as usize];
                pos = BT_POS[bt as usize];
            }
            start += 1;
        }
        0
    }
}

#[no_mangle]
pub extern "C" fn re_error() -> i32 {
    unsafe { ERR }
}

#[no_mangle]
pub extern "C" fn re_error_pos() -> i32 {
    unsafe { ERR_POS }
}

#[no_mangle]
pub extern "C" fn re_steps() -> i32 {
    unsafe { STEPS }
}
