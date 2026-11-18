// Стековая VM: интерпретатор байткода с кадрами вызовов.
// Тот же контракт, что у C-референса: 4 байта на инструкцию, 8 локалов на
// кадр, общий стек значений. Одна операция нагрузки — vm_load + vm_run.

#![no_std]

use core::arch::wasm32::unreachable;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    unreachable()
}

const CODE_CAP: usize = 4096;
const STACK_CAP: usize = 1024;
const FRAME_CAP: usize = 128;
const LOCALS: usize = 8;

const OP_PUSH: i32 = 1;
const OP_POP: i32 = 2;
const OP_DUP: i32 = 3;
const OP_SWAP: i32 = 4;
const OP_ADD: i32 = 5;
const OP_SUB: i32 = 6;
const OP_MUL: i32 = 7;
const OP_DIV: i32 = 8;
const OP_MOD: i32 = 9;
const OP_NEG: i32 = 10;
const OP_EQ: i32 = 11;
const OP_NE: i32 = 12;
const OP_LT: i32 = 13;
const OP_LE: i32 = 14;
const OP_GT: i32 = 15;
const OP_GE: i32 = 16;
const OP_AND: i32 = 17;
const OP_OR: i32 = 18;
const OP_NOT: i32 = 19;
const OP_JMP: i32 = 20;
const OP_JZ: i32 = 21;
const OP_JNZ: i32 = 22;
const OP_LOADL: i32 = 23;
const OP_STOREL: i32 = 24;
const OP_CALL: i32 = 25;
const OP_RET: i32 = 26;
const OP_HALT: i32 = 27;

const ERR_NONE: i32 = 0;
const ERR_OPCODE: i32 = 1;
const ERR_UNDERFLOW: i32 = 2;
const ERR_OVERFLOW: i32 = 3;
const ERR_CALLS: i32 = 4;
const ERR_ZERO: i32 = 5;
const ERR_TARGET: i32 = 6;
const ERR_STEPS: i32 = 7;
const ERR_CODE_LEN: i32 = 8;
const ERR_NOT_LOADED: i32 = 9;
const ERR_LOCAL: i32 = 10;
const ERR_RET: i32 = 11;
const ERR_EMPTY: i32 = 12;

static mut CODE: [u8; CODE_CAP * 4] = [0; CODE_CAP * 4];
static mut VALUES: [i32; STACK_CAP] = [0; STACK_CAP];
static mut FRAMES: [[i32; LOCALS + 1]; FRAME_CAP] = [[0; LOCALS + 1]; FRAME_CAP];

static mut CODE_LEN: i32 = 0;
static mut LOADED: i32 = 0;
static mut SP: i32 = 0;
static mut FP: i32 = 0;
static mut PC: i32 = 0;
static mut ERR: i32 = 0;
static mut STEPS: i32 = 0;
static mut RESULT: i32 = 0;
static mut DEPTH: i32 = 0;

unsafe fn packed_target(i: i32) -> i32 {
    let base = (i * 4) as usize;
    CODE[base + 1] as i32 | ((CODE[base + 2] as i32) << 8)
}

unsafe fn finish() -> i32 {
    DEPTH = SP;
    RESULT = if SP > 0 { VALUES[(SP - 1) as usize] } else { 0 };
    if ERR == ERR_NONE { 0 } else { -1 }
}

#[no_mangle]
pub extern "C" fn vm_code_ptr() -> i32 {
    unsafe { CODE.as_mut_ptr() as i32 }
}

#[no_mangle]
pub extern "C" fn vm_load(count: i32) -> i32 {
    unsafe {
        LOADED = 0;
        ERR = ERR_NONE;
        PC = 0;
        CODE_LEN = 0;

        if count > CODE_CAP as i32 {
            ERR = ERR_CODE_LEN;
            return ERR_CODE_LEN;
        }
        if count <= 0 {
            ERR = ERR_EMPTY;
            return ERR_EMPTY;
        }

        let mut i = 0;
        while i < count {
            let base = (i * 4) as usize;
            let op = CODE[base] as i32;
            if !(OP_PUSH..=OP_HALT).contains(&op) {
                ERR = ERR_OPCODE;
                PC = i;
                return ERR_OPCODE;
            }
            if op == OP_JMP || op == OP_JZ || op == OP_JNZ || op == OP_CALL {
                let target = packed_target(i);
                if target < 0 || target >= count {
                    ERR = ERR_TARGET;
                    PC = i;
                    return ERR_TARGET;
                }
            } else if op == OP_LOADL || op == OP_STOREL {
                if CODE[base + 1] as i32 >= LOCALS as i32 {
                    ERR = ERR_LOCAL;
                    PC = i;
                    return ERR_LOCAL;
                }
            }
            i += 1;
        }

        CODE_LEN = count;
        LOADED = 1;
        0
    }
}

#[no_mangle]
pub extern "C" fn vm_run(limit: i32) -> i32 {
    unsafe {
        if LOADED == 0 {
            ERR = ERR_NOT_LOADED;
            return -1;
        }
        let limit = if limit <= 0 { 1_000_000 } else { limit };

        SP = 0;
        FP = 0;
        PC = 0;
        ERR = ERR_NONE;
        STEPS = 0;
        DEPTH = 0;
        RESULT = 0;
        let mut v = 0;
        while v < LOCALS as i32 {
            FRAMES[0][(v + 1) as usize] = 0;
            v += 1;
        }

        while STEPS < limit {
            if PC < 0 || PC >= CODE_LEN {
                ERR = ERR_TARGET;
                return finish();
            }

            let base = (PC * 4) as usize;
            let op = CODE[base] as i32;
            let x = CODE[base + 1] as i32;
            PC += 1;

            match op {
                OP_PUSH => {
                    let mut a = ((CODE[base + 1] as i32) << 16)
                        | ((CODE[base + 2] as i32) << 8)
                        | CODE[base + 3] as i32;
                    if a & 0x800000 != 0 {
                        a -= 0x1000000;
                    }
                    if SP >= STACK_CAP as i32 {
                        ERR = ERR_OVERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    VALUES[SP as usize] = a;
                    SP += 1;
                }

                OP_POP => {
                    if SP < 1 {
                        ERR = ERR_UNDERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    SP -= 1;
                }

                OP_DUP => {
                    if SP < 1 {
                        ERR = ERR_UNDERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    if SP >= STACK_CAP as i32 {
                        ERR = ERR_OVERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    VALUES[SP as usize] = VALUES[(SP - 1) as usize];
                    SP += 1;
                }

                OP_SWAP => {
                    if SP < 2 {
                        ERR = ERR_UNDERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    VALUES.swap((SP - 1) as usize, (SP - 2) as usize);
                }

                OP_ADD | OP_SUB | OP_MUL | OP_DIV | OP_MOD | OP_EQ | OP_NE | OP_LT | OP_LE
                | OP_GT | OP_GE | OP_AND | OP_OR => {
                    if SP < 2 {
                        ERR = ERR_UNDERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    SP -= 1;
                    let b = VALUES[SP as usize];
                    SP -= 1;
                    let a = VALUES[SP as usize];
                    let out = match op {
                        OP_ADD => a.wrapping_add(b),
                        OP_SUB => a.wrapping_sub(b),
                        OP_MUL => a.wrapping_mul(b),
                        OP_DIV => {
                            if b == 0 {
                                ERR = ERR_ZERO;
                                PC -= 1;
                                return finish();
                            }
                            a.wrapping_div(b)
                        }
                        OP_MOD => {
                            if b == 0 {
                                ERR = ERR_ZERO;
                                PC -= 1;
                                return finish();
                            }
                            a.wrapping_rem(b)
                        }
                        OP_EQ => (a == b) as i32,
                        OP_NE => (a != b) as i32,
                        OP_LT => (a < b) as i32,
                        OP_LE => (a <= b) as i32,
                        OP_GT => (a > b) as i32,
                        OP_GE => (a >= b) as i32,
                        OP_AND => ((a != 0) && (b != 0)) as i32,
                        _ => ((a != 0) || (b != 0)) as i32,
                    };
                    VALUES[SP as usize] = out;
                    SP += 1;
                }

                OP_NEG => {
                    if SP < 1 {
                        ERR = ERR_UNDERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    VALUES[(SP - 1) as usize] = VALUES[(SP - 1) as usize].wrapping_neg();
                }

                OP_NOT => {
                    if SP < 1 {
                        ERR = ERR_UNDERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    VALUES[(SP - 1) as usize] = (VALUES[(SP - 1) as usize] == 0) as i32;
                }

                OP_JMP => {
                    PC = packed_target(PC - 1);
                }

                OP_JZ | OP_JNZ => {
                    if SP < 1 {
                        ERR = ERR_UNDERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    SP -= 1;
                    let value = VALUES[SP as usize];
                    let take = if op == OP_JZ { value == 0 } else { value != 0 };
                    if take {
                        PC = packed_target(PC - 1);
                    }
                }

                OP_LOADL => {
                    if SP >= STACK_CAP as i32 {
                        ERR = ERR_OVERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    VALUES[SP as usize] = FRAMES[FP as usize][(x + 1) as usize];
                    SP += 1;
                }

                OP_STOREL => {
                    if SP < 1 {
                        ERR = ERR_UNDERFLOW;
                        PC -= 1;
                        return finish();
                    }
                    SP -= 1;
                    FRAMES[FP as usize][(x + 1) as usize] = VALUES[SP as usize];
                }

                OP_CALL => {
                    if FP + 1 >= FRAME_CAP as i32 {
                        ERR = ERR_CALLS;
                        PC -= 1;
                        return finish();
                    }
                    FP += 1;
                    FRAMES[FP as usize][0] = PC;
                    let mut i = 0;
                    while i < LOCALS as i32 {
                        FRAMES[FP as usize][(i + 1) as usize] = 0;
                        i += 1;
                    }
                    PC = packed_target(PC - 1);
                }

                OP_RET => {
                    if FP == 0 {
                        ERR = ERR_RET;
                        PC -= 1;
                        return finish();
                    }
                    PC = FRAMES[FP as usize][0];
                    FP -= 1;
                }

                OP_HALT => {
                    STEPS += 1;
                    return finish();
                }

                _ => {
                    ERR = ERR_OPCODE;
                    PC -= 1;
                    return finish();
                }
            }

            STEPS += 1;
        }

        ERR = ERR_STEPS;
        finish()
    }
}

#[no_mangle]
pub extern "C" fn vm_result() -> i32 {
    unsafe { RESULT }
}

#[no_mangle]
pub extern "C" fn vm_depth() -> i32 {
    unsafe { DEPTH }
}

#[no_mangle]
pub extern "C" fn vm_error() -> i32 {
    unsafe { ERR }
}

#[no_mangle]
pub extern "C" fn vm_pc() -> i32 {
    unsafe { PC }
}

#[no_mangle]
pub extern "C" fn vm_steps() -> i32 {
    unsafe { STEPS }
}
