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
    void vm_interpret_macro(const uint32_t* code, size_t code_len, VMState* state);
    void vm_interpret(const uint32_t* code, size_t code_len, VMState* state);
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

static bool verify_states(const VMState& ref, const VMState& test, char* err_buf, size_t err_size) {
    if (ref.pc != test.pc) {
        snprintf(err_buf, err_size, "PC mismatch: expected %d, got %d", ref.pc, test.pc);
        return false;
    }
    if (ref.sp != test.sp) {
        snprintf(err_buf, err_size, "SP mismatch: expected %d, got %d", ref.sp, test.sp);
        return false;
    }
    for (int i = 0; i < ref.sp; i++) {
        if (ref.values[i] != test.values[i]) {
            snprintf(err_buf, err_size, "values[%d] mismatch: expected %d, got %d", i, ref.values[i], test.values[i]);
            return false;
        }
    }
    for (int i = 0; i < 16; i++) {
        if (ref.locals[i] != test.locals[i]) {
            snprintf(err_buf, err_size, "locals[%d] mismatch: expected %d, got %d", i, ref.locals[i], test.locals[i]);
            return false;
        }
    }
    return true;
}

int main() {
    HANDLE thread = GetCurrentThread();
    SetThreadAffinityMask(thread, 1ULL << 0);
    SetPriorityClass(GetCurrentProcess(), REALTIME_PRIORITY_CLASS);
    SetThreadPriority(thread, THREAD_PRIORITY_TIME_CRITICAL);

    // Program 1: Verification & Complex Operations
    uint32_t prog_verify[] = {
        encode_inst(OP_PUSH, 42),
        encode_inst(OP_STOREL, 0),
        encode_inst(OP_PUSH, 100),
        encode_inst(OP_STOREL, 1),
        encode_inst(OP_LOADL, 0),
        encode_inst(OP_LOADL, 1),
        encode_inst(OP_ADD, 0),
        encode_inst(OP_DUP, 0),
        encode_inst(OP_PUSH, 2),
        encode_inst(OP_MUL, 0),
        encode_inst(OP_SWAP, 0),
        encode_inst(OP_SUB, 0),
        encode_inst(OP_STOREL, 2),
        encode_inst(OP_HALT, 0)
    };
    size_t prog_verify_len = sizeof(prog_verify) / sizeof(prog_verify[0]);

    VMState s_cpp, s_macro, s_cand;
    memset(&s_cpp, 0, sizeof(s_cpp));
    memset(&s_macro, 0, sizeof(s_macro));
    memset(&s_cand, 0, sizeof(s_cand));

    vm_interpret_cpp(prog_verify, prog_verify_len, &s_cpp);
    vm_interpret_macro(prog_verify, prog_verify_len, &s_macro);
    vm_interpret(prog_verify, prog_verify_len, &s_cand);

    char err_buf[256] = {0};
    if (!verify_states(s_cpp, s_macro, err_buf, sizeof(err_buf))) {
        printf("{\"verified\": false, \"stage\": \"prog_verify_macro\", \"error\": \"%s\"}\n", err_buf);
        return 1;
    }
    if (!verify_states(s_cpp, s_cand, err_buf, sizeof(err_buf))) {
        printf("{\"verified\": false, \"stage\": \"prog_verify_candidate\", \"error\": \"%s\"}\n", err_buf);
        return 1;
    }

    // Program 2: 20,000 Loop Iterations (sum 1..20000 = 200010000)
    const int N = 20000;
    uint32_t prog_loop[] = {
        encode_inst(OP_PUSH, 0),
        encode_inst(OP_STOREL, 0),
        encode_inst(OP_PUSH, N),
        encode_inst(OP_STOREL, 1),
        // Loop head (PC=4)
        encode_inst(OP_LOADL, 1),
        encode_inst(OP_LOADL, 0),
        encode_inst(OP_ADD, 0),
        encode_inst(OP_STOREL, 0),
        encode_inst(OP_LOADL, 1),
        encode_inst(OP_PUSH, 1),
        encode_inst(OP_SUB, 0),
        encode_inst(OP_STOREL, 1),
        encode_inst(OP_LOADL, 1),
        encode_inst(OP_JNZ, 4),
        // End (PC=14)
        encode_inst(OP_LOADL, 0),
        encode_inst(OP_HALT, 0)
    };
    size_t prog_loop_len = sizeof(prog_loop) / sizeof(prog_loop[0]);
    const uint64_t total_ops = 4ULL + (uint64_t)N * 10ULL + 2ULL;

    memset(&s_cpp, 0, sizeof(s_cpp));
    memset(&s_macro, 0, sizeof(s_macro));
    memset(&s_cand, 0, sizeof(s_cand));
    vm_interpret_cpp(prog_loop, prog_loop_len, &s_cpp);
    vm_interpret_macro(prog_loop, prog_loop_len, &s_macro);
    vm_interpret(prog_loop, prog_loop_len, &s_cand);

    if (!verify_states(s_cpp, s_macro, err_buf, sizeof(err_buf))) {
        printf("{\"verified\": false, \"stage\": \"prog_loop_macro\", \"error\": \"%s\"}\n", err_buf);
        return 1;
    }
    if (!verify_states(s_cpp, s_cand, err_buf, sizeof(err_buf))) {
        printf("{\"verified\": false, \"stage\": \"prog_loop_candidate\", \"error\": \"%s\"}\n", err_buf);
        return 1;
    }

    // Benchmark Cycles
    const int RUNS = 50;
    double cycles_cpp[RUNS];
    double cycles_macro[RUNS];
    double cycles_cand[RUNS];

    for (int r = 0; r < RUNS; r++) {
        // C++
        memset(&s_cpp, 0, sizeof(s_cpp));
        uint64_t t0 = rdtsc_start();
        vm_interpret_cpp(prog_loop, prog_loop_len, &s_cpp);
        uint64_t t1 = rdtsc_end();
        cycles_cpp[r] = (double)(t1 - t0) / (double)total_ops;

        // Macro-ASM Baseline
        memset(&s_macro, 0, sizeof(s_macro));
        uint64_t t2 = rdtsc_start();
        vm_interpret_macro(prog_loop, prog_loop_len, &s_macro);
        uint64_t t3 = rdtsc_end();
        cycles_macro[r] = (double)(t3 - t2) / (double)total_ops;

        // LLM Candidate
        memset(&s_cand, 0, sizeof(s_cand));
        uint64_t t4 = rdtsc_start();
        vm_interpret(prog_loop, prog_loop_len, &s_cand);
        uint64_t t5 = rdtsc_end();
        cycles_cand[r] = (double)(t5 - t4) / (double)total_ops;
    }

    qsort(cycles_cpp, RUNS, sizeof(double), cmp_double);
    qsort(cycles_macro, RUNS, sizeof(double), cmp_double);
    qsort(cycles_cand, RUNS, sizeof(double), cmp_double);

    double med_cpp = cycles_cpp[RUNS / 2];
    double med_macro = cycles_macro[RUNS / 2];
    double med_cand = cycles_cand[RUNS / 2];
    double min_cand = cycles_cand[0];
    double speedup_vs_cpp = ((med_cpp - med_cand) / med_cpp) * 100.0;
    bool parity = (med_cand <= 1.80);

    printf("{\"verified\": true, \"cpp_cycles\": %.2f, \"macro_cycles\": %.2f, \"candidate_cycles\": %.2f, \"min_cycles\": %.2f, \"speedup_percent\": %.1f, \"parity_achieved\": %s}\n",
           med_cpp, med_macro, med_cand, min_cand, speedup_vs_cpp, parity ? "true" : "false");

    return 0;
}
