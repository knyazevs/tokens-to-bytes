movzx eax, byte ptr [rsi]
add rsi, 4
cmp rsi, r13
cmovae eax, r15d   ; r15d = 0 → HALT
jmp qword ptr [r10+rax*8]