#![no_std]

use core::arch::wasm32::unreachable;
use libm::{fabs, trunc};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    unreachable()
}

static mut ACC: f64 = 0.0;
static mut CUR: f64 = 0.0;
static mut SCALE: f64 = 1.0;
static mut LAST_DIGIT: f64 = 0.0;
static mut OPERAND: f64 = 0.0;
static mut LEFT_OPERAND: f64 = 0.0;

static mut OP: i32 = 0;
static mut LAST_OP: i32 = 0;
static mut START_NEW: i32 = 1;
static mut FRAC: i32 = 0;
static mut DIGITS_AFTER_DOT: i32 = 0;
static mut ERR: i32 = 0;

unsafe fn reset_entry() {
    CUR = 0.0;
    SCALE = 1.0;
    LAST_DIGIT = 0.0;
    START_NEW = 1;
    FRAC = 0;
    DIGITS_AFTER_DOT = 0;
}

unsafe fn clear_all() {
    reset_entry();
    ACC = 0.0;
    OP = 0;
    LAST_OP = 0;
    ERR = 0;
    OPERAND = 0.0;
    LEFT_OPERAND = 0.0;
}

unsafe fn recompute_last() {
    let t = trunc(fabs(CUR / SCALE) + 1e-9);
    let mut d = t - trunc(t / 10.0) * 10.0;
    if CUR < 0.0 {
        d = -d;
    }
    LAST_DIGIT = d;
}

unsafe fn apply_op() {
    match OP {
        1 => ACC += CUR,
        2 => ACC -= CUR,
        3 => ACC *= CUR,
        4 => {
            if CUR == 0.0 {
                ERR = 1;
                ACC = 0.0;
            } else {
                ACC /= CUR;
            }
        }
        _ => ACC = CUR,
    }
}

#[no_mangle]
pub extern "C" fn clear() {
    unsafe { clear_all() }
}

#[no_mangle]
pub extern "C" fn ce() {
    unsafe {
        reset_entry();
        ERR = 0;
    }
}

#[no_mangle]
pub extern "C" fn digit(value: i32) {
    unsafe {
        if ERR != 0 {
            clear_all();
        }
        if START_NEW != 0 {
            reset_entry();
            START_NEW = 0;
        }
        let d = value as f64;
        let sign = if CUR < 0.0 { -1.0 } else { 1.0 };
        if FRAC != 0 {
            SCALE /= 10.0;
            CUR += d * SCALE * sign;
            DIGITS_AFTER_DOT += 1;
        } else {
            CUR = CUR * 10.0 + d * sign;
            SCALE = 1.0;
        }
        LAST_DIGIT = d;
    }
}

#[no_mangle]
pub extern "C" fn dot() {
    unsafe {
        if ERR != 0 {
            clear_all();
        }
        if START_NEW != 0 {
            reset_entry();
            START_NEW = 0;
        }
        if FRAC == 0 {
            FRAC = 1;
        }
    }
}

#[no_mangle]
pub extern "C" fn back() {
    unsafe {
        if ERR != 0 {
            clear_all();
            return;
        }
        if START_NEW != 0 {
            return;
        }
        if FRAC != 0 && DIGITS_AFTER_DOT == 0 {
            FRAC = 0;
            return;
        }
        if FRAC != 0 {
            CUR -= LAST_DIGIT * SCALE;
            SCALE *= 10.0;
            DIGITS_AFTER_DOT -= 1;
            if DIGITS_AFTER_DOT > 0 {
                recompute_last();
            } else {
                FRAC = 0;
                SCALE = 1.0;
                recompute_last();
            }
        } else {
            CUR = trunc((CUR - LAST_DIGIT) / 10.0);
            recompute_last();
            if CUR == 0.0 {
                START_NEW = 1;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn neg() {
    unsafe {
        if ERR != 0 {
            clear_all();
            return;
        }
        if START_NEW != 0 && OP != 0 {
            ACC = -ACC;
        } else {
            CUR = -CUR;
            recompute_last();
        }
    }
}

#[no_mangle]
pub extern "C" fn op(code: i32) {
    unsafe {
        if ERR != 0 {
            clear_all();
        }
        if OP != 0 {
            if START_NEW == 0 {
                apply_op();
                CUR = ACC;
            }
        } else {
            ACC = CUR;
        }
        LAST_OP = code;
        OP = code;
        START_NEW = 1;
        FRAC = 0;
        DIGITS_AFTER_DOT = 0;
        SCALE = 1.0;
        LAST_DIGIT = 0.0;
        ERR = 0;
    }
}

#[no_mangle]
pub extern "C" fn equals() {
    unsafe {
        if ERR != 0 {
            return;
        }
        if OP == 0 && LAST_OP != 0 && START_NEW != 0 {
            OP = LAST_OP;
            CUR = OPERAND;
        }
        if OP != 0 {
            LEFT_OPERAND = ACC;
            OPERAND = CUR;
            apply_op();
            CUR = ACC;
            LAST_OP = OP;
            OP = 0;
            START_NEW = 1;
            FRAC = 0;
            DIGITS_AFTER_DOT = 0;
            SCALE = 1.0;
            LAST_DIGIT = 0.0;
        } else {
            START_NEW = 1;
        }
    }
}

#[no_mangle]
pub extern "C" fn display() -> f64 {
    unsafe {
        if OP != 0 && START_NEW != 0 { ACC } else { CUR }
    }
}

#[no_mangle]
pub extern "C" fn acc() -> f64 {
    unsafe { ACC }
}

#[no_mangle]
pub extern "C" fn cur() -> f64 {
    unsafe { CUR }
}

#[no_mangle]
pub extern "C" fn opCode() -> i32 {
    unsafe { OP }
}

#[no_mangle]
pub extern "C" fn error() -> i32 {
    unsafe { ERR }
}

#[no_mangle]
pub extern "C" fn fresh() -> i32 {
    unsafe { START_NEW }
}

#[no_mangle]
pub extern "C" fn lastOp() -> i32 {
    unsafe { LAST_OP }
}

#[no_mangle]
pub extern "C" fn operand() -> f64 {
    unsafe { OPERAND }
}

#[no_mangle]
pub extern "C" fn leftOperand() -> f64 {
    unsafe { LEFT_OPERAND }
}
