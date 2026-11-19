#include <stdint.h>
#include <stddef.h>

struct StandardNode {
    uint8_t  type;
    uint8_t  flags;
    uint16_t id;
    uint32_t value;
    uint32_t next;
};

struct PackedNodeBitfield {
    uint64_t type  : 4;
    uint64_t flags : 6;
    uint64_t id    : 14;
    uint64_t value : 18;
    uint64_t next  : 22;
};

extern "C" {

uint64_t query_standard_cpp(const StandardNode* nodes, size_t count, uint32_t target_type, uint32_t min_id, uint32_t max_id) {
    uint64_t sum = 0;
    for (size_t i = 0; i < count; i++) {
        if (nodes[i].type == target_type && nodes[i].id >= min_id && nodes[i].id <= max_id) {
            sum += nodes[i].value;
        }
    }
    return sum;
}

uint64_t query_bitfield_cpp(const PackedNodeBitfield* nodes, size_t count, uint32_t target_type, uint32_t min_id, uint32_t max_id) {
    uint64_t sum = 0;
    for (size_t i = 0; i < count; i++) {
        if (nodes[i].type == target_type && nodes[i].id >= min_id && nodes[i].id <= max_id) {
            sum += nodes[i].value;
        }
    }
    return sum;
}

}
