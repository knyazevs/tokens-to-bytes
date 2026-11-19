#include <windows.h>
#include <intrin.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum Opcode : uint8_t {
    OP_HALT   = 0,
    OP_PUSH   = 1,
    OP_POP    = 2,
    OP_DUP    = 3,
    OP_SWAP   = 4,
    OP_ADD    = 5,
    OP_SUB    = 6,
    OP_MUL    = 7,
    OP_LOADL  = 8,
    OP_STOREL = 9,
    OP_JNZ    = 10,
    OP_JMP    = 11
};

struct VMState {
    int32_t sp;
    int32_t pc;
    int32_t values[256];
    int32_t locals[16];
};

extern "C" {
    void vm_interpret_cpp(const uint32_t* code, size_t code_len, VMState* state);
    void vm_interpret_asm(const uint32_t* code, size_t code_len, VMState* state);
}

static inline uint32_t encode_inst(uint8_t op, int32_t imm) {
    return (static_cast<uint32_t>(imm) << 8) | op;
}

static inline uint64_t rdtsc_start() {
    _mm_lfence();
    uint64_t t = __rdtsc();
    _mm_lfence();
    return t;
}

static inline uint64_t rdtsc_end() {
    _mm_lfence();
    uint64_t t = __rdtsc();
    _mm_lfence();
    return t;
}

static int cmp_double(const void* a, const void* b) {
    double da = *(const double*)a;
    double db = *(const double*)b;
    return (da > db) - (da < db);
}

static bool verify_states(const char* name, const VMState& ref, const VMState& test) {
    if (ref.pc != test.pc) {
        printf("[%s] PC mismatch: ref=%d, test=%d\n", name, ref.pc, test.pc);
        return false;
    }
    if (ref.sp != test.sp) {
        printf("[%s] SP mismatch: ref=%d, test=%d\n", name, ref.sp, test.sp);
        return false;
    }
    for (int i = 0; i < ref.sp; i++) {
        if (ref.values[i] != test.values[i]) {
            printf("[%s] values[%d] mismatch: ref=%d, test=%d\n", name, i, ref.values[i], test.values[i]);
            return false;
        }
    }
    for (int i = 0; i < 16; i++) {
        if (ref.locals[i] != test.locals[i]) {
            printf("[%s] locals[%d] mismatch: ref=%d, test=%d\n", name, i, ref.locals[i], test.locals[i]);
            return false;
        }
    }
    return true;
}

int main() {
    // Pin to CPU 0 (P-core)
    HANDLE thread = GetCurrentThread();
    SetThreadAffinityMask(thread, 1ULL << 0);
    SetPriorityClass(GetCurrentProcess(), REALTIME_PRIORITY_CLASS);
    SetThreadPriority(thread, THREAD_PRIORITY_TIME_CRITICAL);

    printf("=== Native x86-64 Duel 3: Stack VM Bytecode Interpreter ===\n");
    printf("Hardware: Intel 12th Gen Core (P-core pinned, REALTIME priority)\n");
    printf("Comparison: Direct Threaded ASM vs Standard C++ -O3 Switch-Case\n\n");

    // -------------------------------------------------------------
    // Program 1: Verification & Complex State Machine
    // -------------------------------------------------------------
    uint32_t prog_verify[] = {
        encode_inst(OP_PUSH, 42),      // 0: push 42
        encode_inst(OP_STOREL, 0),     // 1: local[0] = 42
        encode_inst(OP_PUSH, 100),     // 2: push 100
        encode_inst(OP_STOREL, 1),     // 3: local[1] = 100
        encode_inst(OP_LOADL, 0),      // 4: push 42
        encode_inst(OP_LOADL, 1),      // 5: push 100
        encode_inst(OP_ADD, 0),        // 6: 142
        encode_inst(OP_DUP, 0),        // 7: dup 142
        encode_inst(OP_PUSH, 2),       // 8: push 2
        encode_inst(OP_MUL, 0),        // 9: 284
        encode_inst(OP_SWAP, 0),       // 10: swap (284, 142) -> 142, 284
        encode_inst(OP_SUB, 0),        // 11: 142 - 284 = -142
        encode_inst(OP_STOREL, 2),     // 12: local[2] = -142
        encode_inst(OP_HALT, 0)        // 13: halt
    };
    size_t prog_verify_len = sizeof(prog_verify) / sizeof(prog_verify[0]);

    VMState s_cpp, s_asm;
    memset(&s_cpp, 0, sizeof(s_cpp));
    memset(&s_asm, 0, sizeof(s_asm));

    vm_interpret_cpp(prog_verify, prog_verify_len, &s_cpp);
    vm_interpret_asm(prog_verify, prog_verify_len, &s_asm);

    if (!verify_states("Verification Program", s_cpp, s_asm)) {
        printf("FAILED verification!\n");
        return 1;
    }
    printf("[Verification] Correctness: C++ and Direct Threaded ASM produce IDENTICAL states (100%% match).\n\n");

    // -------------------------------------------------------------
    // Program 2: Tight Compute Reduction Loop
    // Loop N iterations:
    // local[0] = N (counter)
    // local[1] = 0 (sum)
    // loop:
    //   local[1] = local[1] + local[0]
    //   local[0] = local[0] - 1
    //   if (local[0] != 0) goto loop
    // -------------------------------------------------------------
    const int32_t ITERS = 20000;
    uint32_t prog_loop[] = {
        encode_inst(OP_PUSH, ITERS),   // 0: local[0] = ITERS
        encode_inst(OP_STOREL, 0),     // 1
        encode_inst(OP_PUSH, 0),       // 2: local[1] = 0
        encode_inst(OP_STOREL, 1),     // 3
        // loop_start (index 4):
        encode_inst(OP_LOADL, 1),      // 4
        encode_inst(OP_LOADL, 0),      // 5
        encode_inst(OP_ADD, 0),        // 6: local[1] + local[0]
        encode_inst(OP_STOREL, 1),     // 7
        encode_inst(OP_LOADL, 0),      // 8
        encode_inst(OP_PUSH, 1),       // 9
        encode_inst(OP_SUB, 0),        // 10: local[0] - 1
        encode_inst(OP_DUP, 0),        // 11: dup for JNZ check
        encode_inst(OP_STOREL, 0),     // 12: save back to local[0]
        encode_inst(OP_JNZ, 4),        // 13: if != 0 goto 4
        encode_inst(OP_LOADL, 1),      // 14: push final sum
        encode_inst(OP_HALT, 0)        // 15
    };
    size_t prog_loop_len = sizeof(prog_loop) / sizeof(prog_loop[0]);

    // Verify Loop Program
    memset(&s_cpp, 0, sizeof(s_cpp));
    memset(&s_asm, 0, sizeof(s_asm));
    vm_interpret_cpp(prog_loop, prog_loop_len, &s_cpp);
    vm_interpret_asm(prog_loop, prog_loop_len, &s_asm);
    if (!verify_states("Loop Program", s_cpp, s_asm)) {
        printf("FAILED loop verification!\n");
        return 1;
    }
    printf("[Loop Program] Verified: sum(1..%d) = %d in both engines.\n\n", ITERS, s_asm.values[0]);

    // Total instructions per execution of loop:
    // 4 setup + ITERS * 10 loop insts + 2 finish = ~200,006 instructions.
    const uint64_t total_insts = 4 + (uint64_t)ITERS * 10 + 2;

    const int BENCH_ROUNDS = 500;
    double cycles_cpp[BENCH_ROUNDS];
    double cycles_asm[BENCH_ROUNDS];

    // Warmup
    for (int w = 0; w < 50; w++) {
        memset(&s_cpp, 0, sizeof(s_cpp));
        memset(&s_asm, 0, sizeof(s_asm));
        vm_interpret_cpp(prog_loop, prog_loop_len, &s_cpp);
        vm_interpret_asm(prog_loop, prog_loop_len, &s_asm);
    }

    // Benchmark C++
    for (int r = 0; r < BENCH_ROUNDS; r++) {
        memset(&s_cpp, 0, sizeof(s_cpp));
        uint64_t t0 = rdtsc_start();
        vm_interpret_cpp(prog_loop, prog_loop_len, &s_cpp);
        uint64_t t1 = rdtsc_end();
        cycles_cpp[r] = static_cast<double>(t1 - t0) / total_insts;
    }

    // Benchmark ASM
    for (int r = 0; r < BENCH_ROUNDS; r++) {
        memset(&s_asm, 0, sizeof(s_asm));
        uint64_t t0 = rdtsc_start();
        vm_interpret_asm(prog_loop, prog_loop_len, &s_asm);
        uint64_t t1 = rdtsc_end();
        cycles_asm[r] = static_cast<double>(t1 - t0) / total_insts;
    }

    qsort(cycles_cpp, BENCH_ROUNDS, sizeof(double), cmp_double);
    qsort(cycles_asm, BENCH_ROUNDS, sizeof(double), cmp_double);

    double med_cpp = cycles_cpp[BENCH_ROUNDS / 2];
    double min_cpp = cycles_cpp[0];
    double med_asm = cycles_asm[BENCH_ROUNDS / 2];
    double min_asm = cycles_asm[0];

    printf("======================================================================\n");
    printf("Benchmark: Bytecode Dispatch Latency (Reduction Loop, 200,006 insts)\n");
    printf("======================================================================\n");
    printf("Implementation         | Median Cycles / Op | Min Cycles / Op | Speedup\n");
    printf("-----------------------+--------------------+-----------------+---------\n");
    printf("Standard C++ (-O3)     | %14.2f c    | %11.2f c   |  baseline\n", med_cpp, min_cpp);
    printf("Direct Threaded ASM    | %14.2f c    | %11.2f c   |  +%4.1f %%\n",
           med_asm, min_asm, (med_cpp - med_asm) / med_cpp * 100.0);
    printf("-----------------------+--------------------+-----------------+---------\n\n");

    if (med_asm < med_cpp) {
        printf(">> RESULT: Direct Threaded x86-64 ASM WINS by %4.1f%% fewer cycles per instruction!\n",
               (med_cpp - med_asm) / med_cpp * 100.0);
        printf("   Why: Dedicated indirect branch targets per opcode eliminate BTB aliasing,\n");
        printf("   whereas standard C++ forces all instructions through a single centralized switch jump.\n");
    } else {
        printf(">> RESULT: C++ parity/win.\n");
    }

    return 0;
}
