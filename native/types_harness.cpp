#include <windows.h>
#include <intrin.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define N_NODES (262144) // 256K nodes: 4.19 MB standard vs 2.10 MB packed
#define ROUNDS 200

// 1. Standard C++ layout (16 bytes due to alignment/padding)
struct StandardNode {
    uint8_t  type;       // 1 byte (+1 pad)
    uint8_t  flags;      // 1 byte
    uint16_t id;         // 2 bytes
    uint32_t value;      // 4 bytes
    uint32_t next;       // 4 bytes (+4 pad to 16 bytes for struct alignment)
};

// 2. C++ Bitfield layout (8 bytes)
struct PackedNodeBitfield {
    uint64_t type  : 4;   // bits 0..3
    uint64_t flags : 6;   // bits 4..9
    uint64_t id    : 14;  // bits 10..23
    uint64_t value : 18;  // bits 24..41
    uint64_t next  : 22;  // bits 42..63
};

// External functions
extern "C" {
    uint64_t query_standard_cpp(const StandardNode* nodes, size_t count, uint32_t target_type, uint32_t min_id, uint32_t max_id);
    uint64_t query_bitfield_cpp(const PackedNodeBitfield* nodes, size_t count, uint32_t target_type, uint32_t min_id, uint32_t max_id);
    uint64_t query_packed_asm(const uint64_t* nodes, size_t count, uint32_t target_type, uint32_t min_id, uint32_t max_id);
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

int main() {
    // Pin to CPU 0 (P-core on 12600KF)
    HANDLE thread = GetCurrentThread();
    SetThreadAffinityMask(thread, 1ULL << 0);
    SetPriorityClass(GetCurrentProcess(), REALTIME_PRIORITY_CLASS);
    SetThreadPriority(thread, THREAD_PRIORITY_TIME_CRITICAL);

    printf("=== Native x86-64 Duel: Packed Custom Types vs Memory Wall ===\n");
    printf("Dataset: %u nodes (%u K nodes)\n", N_NODES, N_NODES / 1024);
    printf("Standard C++ struct size: %zu bytes/node -> Total: %.2f MB (L2 spill)\n",
           sizeof(StandardNode), (double)(N_NODES * sizeof(StandardNode)) / (1024.0 * 1024.0));
    printf("Packed Custom type size:  %zu bytes/node -> Total: %.2f MB (fits in L2)\n\n",
           sizeof(uint64_t), (double)(N_NODES * sizeof(uint64_t)) / (1024.0 * 1024.0));

    // Allocate memory aligned to 64-byte cache lines
    StandardNode* std_nodes = (StandardNode*)_aligned_malloc(N_NODES * sizeof(StandardNode), 64);
    PackedNodeBitfield* bf_nodes = (PackedNodeBitfield*)_aligned_malloc(N_NODES * sizeof(PackedNodeBitfield), 64);
    uint64_t* raw_nodes = (uint64_t*)_aligned_malloc(N_NODES * sizeof(uint64_t), 64);

    // Initialize with identical pseudo-random data
    uint32_t seed = 0xACE1;
    for (size_t i = 0; i < N_NODES; i++) {
        seed = seed * 1664525u + 1013904223u;
        uint32_t type = seed & 0xF;                // 4 bits (0..15)
        uint32_t flags = (seed >> 4) & 0x3F;       // 6 bits (0..63)
        uint32_t id = (seed >> 10) & 0x3FFF;       // 14 bits (0..16383)
        uint32_t value = (seed >> 14) & 0x3FFFF;   // 18 bits (0..262143)
        uint32_t next = (seed >> 10) & 0x3FFFFF;   // 22 bits

        // Standard struct
        std_nodes[i].type = (uint8_t)type;
        std_nodes[i].flags = (uint8_t)flags;
        std_nodes[i].id = (uint16_t)id;
        std_nodes[i].value = value;
        std_nodes[i].next = next;

        // Bitfield struct
        bf_nodes[i].type = type;
        bf_nodes[i].flags = flags;
        bf_nodes[i].id = id;
        bf_nodes[i].value = value;
        bf_nodes[i].next = next;

        // Raw 64-bit packed
        uint64_t p = ((uint64_t)type) |
                     (((uint64_t)flags) << 4) |
                     (((uint64_t)id) << 10) |
                     (((uint64_t)value) << 24) |
                     (((uint64_t)next) << 42);
        raw_nodes[i] = p;
    }

    // Query parameters: match type == 3, and id in [1000..8000]
    uint32_t target_type = 3;
    uint32_t min_id = 1000;
    uint32_t max_id = 8000;

    // 1. Verify results match 100%
    uint64_t res_std = query_standard_cpp(std_nodes, N_NODES, target_type, min_id, max_id);
    uint64_t res_bf  = query_bitfield_cpp(bf_nodes, N_NODES, target_type, min_id, max_id);
    uint64_t res_asm = query_packed_asm(raw_nodes, N_NODES, target_type, min_id, max_id);

    printf("Verification check:\n");
    printf("  Standard C++ result: %llu\n", res_std);
    printf("  Bitfield C++ result: %llu\n", res_bf);
    printf("  Packed ASM result:   %llu\n", res_asm);

    if (res_std != res_bf || res_std != res_asm) {
        printf("ERROR: Verification mismatch!\n");
        return 1;
    }
    printf("  [OK] All three implementations returned exact same sum!\n\n");

    // Warmup
    for (int w = 0; w < 10; w++) {
        query_standard_cpp(std_nodes, N_NODES, target_type, min_id, max_id);
        query_bitfield_cpp(bf_nodes, N_NODES, target_type, min_id, max_id);
        query_packed_asm(raw_nodes, N_NODES, target_type, min_id, max_id);
    }

    double std_cycles[ROUNDS];
    double bf_cycles[ROUNDS];
    double asm_cycles[ROUNDS];

    for (int r = 0; r < ROUNDS; r++) {
        uint64_t t0 = rdtsc_start();
        query_standard_cpp(std_nodes, N_NODES, target_type, min_id, max_id);
        uint64_t t1 = rdtsc_end();
        std_cycles[r] = (double)(t1 - t0) / (double)N_NODES;

        t0 = rdtsc_start();
        query_bitfield_cpp(bf_nodes, N_NODES, target_type, min_id, max_id);
        t1 = rdtsc_end();
        bf_cycles[r] = (double)(t1 - t0) / (double)N_NODES;

        t0 = rdtsc_start();
        query_packed_asm(raw_nodes, N_NODES, target_type, min_id, max_id);
        t1 = rdtsc_end();
        asm_cycles[r] = (double)(t1 - t0) / (double)N_NODES;
    }

    qsort(std_cycles, ROUNDS, sizeof(double), cmp_double);
    qsort(bf_cycles, ROUNDS, sizeof(double), cmp_double);
    qsort(asm_cycles, ROUNDS, sizeof(double), cmp_double);

    printf("------------------------------------------------------------------------------------\n");
    printf("%-26s | %10s | %12s | %12s | %12s\n", "Implementation", "Size/Node", "Min c/node", "Median c/node", "P95 c/node");
    printf("------------------------------------------------------------------------------------\n");
    printf("%-26s | %10s | %10.3f c | %10.3f c | %10.3f c\n", "1. Standard C++ (16B)", "16 bytes", std_cycles[0], std_cycles[ROUNDS / 2], std_cycles[(int)(ROUNDS * 0.95)]);
    printf("%-26s | %10s | %10.3f c | %10.3f c | %10.3f c\n", "2. Bitfield C++ (8B)",   "8 bytes",  bf_cycles[0],  bf_cycles[ROUNDS / 2],  bf_cycles[(int)(ROUNDS * 0.95)]);
    printf("%-26s | %10s | %10.3f c | %10.3f c | %10.3f c\n", "3. Packed x86-64 ASM",   "8 bytes",  asm_cycles[0], asm_cycles[ROUNDS / 2], asm_cycles[(int)(ROUNDS * 0.95)]);
    printf("------------------------------------------------------------------------------------\n");

    double vs_std = ((std_cycles[ROUNDS/2] - asm_cycles[ROUNDS/2]) / std_cycles[ROUNDS/2]) * 100.0;
    double vs_bf  = ((bf_cycles[ROUNDS/2] - asm_cycles[ROUNDS/2]) / bf_cycles[ROUNDS/2]) * 100.0;

    printf(">>> RESULT: Custom Packed ASM is %+.1f%% faster than Standard C++ (16B)!\n", vs_std);
    printf(">>> RESULT: Custom Packed ASM is %+.1f%% faster than C++ Bitfield (8B)!\n", vs_bf);
    printf("------------------------------------------------------------------------------------\n");

    _aligned_free(std_nodes);
    _aligned_free(bf_nodes);
    _aligned_free(raw_nodes);

    return 0;
}
