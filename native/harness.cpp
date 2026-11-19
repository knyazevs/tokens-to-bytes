#include <windows.h>
#include <intrin.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define N_ARRAYS 1024
#define ROUNDS 1000

// External function prototypes
extern "C" {
    void sort4_cpp(int32_t a[4]);
    void sort4_asm(int32_t a[4]);
    void sort4_batch_cpp(int32_t* data, size_t count);
    void sort4_batch_asm(int32_t* data, size_t count);
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

// Compare function for double qsort
static int cmp_double(const void* a, const void* b) {
    double da = *(const double*)a;
    double db = *(const double*)b;
    return (da > db) - (da < db);
}

// Test harness verification
static bool verify_sort4(const char* name, void (*fn)(int32_t*)) {
    int32_t p[4] = {1, 2, 3, 4};
    int total_tested = 0;
    
    // Test all 24 permutations of {1, 2, 3, 4}
    for (int i0 = 0; i0 < 4; i0++) {
        for (int i1 = 0; i1 < 4; i1++) {
            if (i1 == i0) continue;
            for (int i2 = 0; i2 < 4; i2++) {
                if (i2 == i0 || i2 == i1) continue;
                for (int i3 = 0; i3 < 4; i3++) {
                    if (i3 == i0 || i3 == i1 || i3 == i2) continue;
                    
                    int32_t arr[4] = {p[i0], p[i1], p[i2], p[i3]};
                    fn(arr);
                    if (arr[0] != 1 || arr[1] != 2 || arr[2] != 3 || arr[3] != 4) {
                        printf("[%s] FAILED on permutation {%d, %d, %d, %d} -> got {%d, %d, %d, %d}\n",
                               name, p[i0], p[i1], p[i2], p[i3], arr[0], arr[1], arr[2], arr[3]);
                        return false;
                    }
                    total_tested++;
                }
            }
        }
    }
    
    // Test duplicates and negatives
    int32_t edge_cases[][4] = {
        {-5, 10, -5, 0},
        {7, 7, 7, 7},
        {100, -100, 50, -50},
        {0, 0, 1, 0},
        {-1, -2, -3, -4}
    };
    
    for (int e = 0; e < 5; e++) {
        int32_t arr[4] = {edge_cases[e][0], edge_cases[e][1], edge_cases[e][2], edge_cases[e][3]};
        fn(arr);
        for (int k = 0; k < 3; k++) {
            if (arr[k] > arr[k + 1]) {
                printf("[%s] FAILED on edge case %d\n", name, e);
                return false;
            }
        }
        total_tested++;
    }
    
    printf("[%s] Tests passed: %d cases verified OK.\n", name, total_tested);
    return true;
}

int main() {
    // Pin to CPU 0 (P-core on Alder Lake 12600KF)
    HANDLE thread = GetCurrentThread();
    SetThreadAffinityMask(thread, 1ULL << 0);
    SetPriorityClass(GetCurrentProcess(), REALTIME_PRIORITY_CLASS);
    SetThreadPriority(thread, THREAD_PRIORITY_TIME_CRITICAL);

    printf("=== Native x86-64 Duel: Sort4 Kernel ===\n");
    printf("Hardware: Intel 12th Gen Core (P-core pinned, REALTIME priority)\n\n");

    // 1. Correctness check
    if (!verify_sort4("C++ baseline", sort4_cpp)) return 1;
    if (!verify_sort4("ASM manual", sort4_asm)) return 1;
    printf("\n");

    // 2. Prepare test data in L1 cache (1024 arrays x 4 ints = 16 KB)
    alignas(64) static int32_t original_data[N_ARRAYS * 4];
    alignas(64) static int32_t working_data[N_ARRAYS * 4];

    // Seed PRNG
    uint32_t seed = 0x12345678;
    for (int i = 0; i < N_ARRAYS * 4; i++) {
        seed = seed * 1664525u + 1013904223u;
        original_data[i] = (int32_t)(seed % 100000) - 50000;
    }

    double cpp_cycles[ROUNDS];
    double asm_cycles[ROUNDS];

    // Warmup
    for (int w = 0; w < 100; w++) {
        memcpy(working_data, original_data, sizeof(working_data));
        sort4_batch_cpp(working_data, N_ARRAYS);
        memcpy(working_data, original_data, sizeof(working_data));
        sort4_batch_asm(working_data, N_ARRAYS);
    }

    // Benchmark C++
    for (int r = 0; r < ROUNDS; r++) {
        memcpy(working_data, original_data, sizeof(working_data));
        uint64_t t0 = rdtsc_start();
        sort4_batch_cpp(working_data, N_ARRAYS);
        uint64_t t1 = rdtsc_end();
        cpp_cycles[r] = (double)(t1 - t0) / (double)N_ARRAYS;
    }

    // Benchmark ASM
    for (int r = 0; r < ROUNDS; r++) {
        memcpy(working_data, original_data, sizeof(working_data));
        uint64_t t0 = rdtsc_start();
        sort4_batch_asm(working_data, N_ARRAYS);
        uint64_t t1 = rdtsc_end();
        asm_cycles[r] = (double)(t1 - t0) / (double)N_ARRAYS;
    }

    qsort(cpp_cycles, ROUNDS, sizeof(double), cmp_double);
    qsort(asm_cycles, ROUNDS, sizeof(double), cmp_double);

    double cpp_min = cpp_cycles[0];
    double cpp_med = cpp_cycles[ROUNDS / 2];
    double cpp_p95 = cpp_cycles[(int)(ROUNDS * 0.95)];

    double asm_min = asm_cycles[0];
    double asm_med = asm_cycles[ROUNDS / 2];
    double asm_p95 = asm_cycles[(int)(ROUNDS * 0.95)];

    printf("----------------------------------------------------------------------\n");
    printf("%-20s | %12s | %12s | %12s\n", "Implementation", "Min Cycles", "Median Cycles", "P95 Cycles");
    printf("----------------------------------------------------------------------\n");
    printf("%-20s | %10.2f c | %10.2f c | %10.2f c\n", "C++ (-O3 native)", cpp_min, cpp_med, cpp_p95);
    printf("%-20s | %10.2f c | %10.2f c | %10.2f c\n", "ASM x86-64 manual", asm_min, asm_med, asm_p95);
    printf("----------------------------------------------------------------------\n");

    double speedup_min = ((cpp_min - asm_min) / cpp_min) * 100.0;
    double speedup_med = ((cpp_med - asm_med) / cpp_med) * 100.0;

    if (asm_min < cpp_min) {
        printf(">>> RESULT: ASM WINS by %+.1f%% (Min) / %+.1f%% (Median) fewer cycles!\n", speedup_min, speedup_med);
    } else {
        printf(">>> RESULT: C++ leads by %+.1f%% (Min) / %+.1f%% (Median)\n", -speedup_min, -speedup_med);
    }
    printf("----------------------------------------------------------------------\n");

    return 0;
}
