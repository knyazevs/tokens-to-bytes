#include <stdint.h>
#include <stddef.h>

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

extern "C" void vm_interpret_cpp(const uint32_t* code, size_t code_len, VMState* state) {
    int32_t pc = state->pc;
    int32_t sp = state->sp;
    int32_t* values = state->values;
    int32_t* locals = state->locals;

    while (static_cast<size_t>(pc) < code_len) {
        uint32_t inst = code[pc++];
        uint8_t op = static_cast<uint8_t>(inst & 0xFF);

        switch (op) {
            case OP_HALT:
                state->pc = pc;
                state->sp = sp;
                return;

            case OP_PUSH: {
                int32_t imm = static_cast<int32_t>(inst) >> 8;
                values[sp++] = imm;
                break;
            }

            case OP_POP:
                --sp;
                break;

            case OP_DUP:
                values[sp] = values[sp - 1];
                ++sp;
                break;

            case OP_SWAP: {
                int32_t tmp = values[sp - 1];
                values[sp - 1] = values[sp - 2];
                values[sp - 2] = tmp;
                break;
            }

            case OP_ADD:
                values[sp - 2] += values[sp - 1];
                --sp;
                break;

            case OP_SUB:
                values[sp - 2] -= values[sp - 1];
                --sp;
                break;

            case OP_MUL:
                values[sp - 2] *= values[sp - 1];
                --sp;
                break;

            case OP_LOADL: {
                uint8_t idx = static_cast<uint8_t>((inst >> 8) & 0x0F);
                values[sp++] = locals[idx];
                break;
            }

            case OP_STOREL: {
                uint8_t idx = static_cast<uint8_t>((inst >> 8) & 0x0F);
                locals[idx] = values[--sp];
                break;
            }

            case OP_JNZ: {
                int32_t cond = values[--sp];
                if (cond != 0) {
                    pc = static_cast<int32_t>((inst >> 8) & 0xFFFF);
                }
                break;
            }

            case OP_JMP:
                pc = static_cast<int32_t>((inst >> 8) & 0xFFFF);
                break;

            default:
                state->pc = pc;
                state->sp = sp;
                return;
        }
    }

    state->pc = pc;
    state->sp = sp;
}
