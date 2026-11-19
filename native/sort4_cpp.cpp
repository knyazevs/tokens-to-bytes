#include <stdint.h>
#include <stddef.h>
#include <algorithm>

extern "C" {

void sort4_cpp(int32_t a[4]) {
    int32_t v0 = a[0];
    int32_t v1 = a[1];
    int32_t v2 = a[2];
    int32_t v3 = a[3];

    // Standard 5-comparator sorting network
    if (v0 > v1) std::swap(v0, v1);
    if (v2 > v3) std::swap(v2, v3);
    if (v0 > v2) std::swap(v0, v2);
    if (v1 > v3) std::swap(v1, v3);
    if (v1 > v2) std::swap(v1, v2);

    a[0] = v0;
    a[1] = v1;
    a[2] = v2;
    a[3] = v3;
}

void sort4_batch_cpp(int32_t* data, size_t count) {
    for (size_t i = 0; i < count; i++) {
        sort4_cpp(data + i * 4);
    }
}

}
