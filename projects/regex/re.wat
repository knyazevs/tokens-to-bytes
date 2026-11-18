;; Regex-движок: компиляция в байткод и бэктрекинг-VM.
;; Тот же контракт и тот же байткод, что у C-референса.
;;
;; Память: 8 страниц. Буферы по фиксированным адресам, без аллокатора.
;;   pattern 0x10000 (4096)   text 0x20000 (8192)   prog 0x30000 (2048×16)
;;   classes 0x40000 (2048)   bt_pc 0x50000        bt_pos 0x60000

(module
  (memory (export "memory") 8)

  (global $PATTERN i32 (i32.const 0x10000))
  (global $TEXT i32 (i32.const 0x20000))
  (global $PROG i32 (i32.const 0x30000))
  (global $CLASSES i32 (i32.const 0x40000))
  (global $BT_PC i32 (i32.const 0x50000))
  (global $BT_POS i32 (i32.const 0x60000))

  (global $ERR_CHAR i32 (i32.const 1))
  (global $ERR_OPEN i32 (i32.const 2))
  (global $ERR_CLOSE i32 (i32.const 3))
  (global $ERR_CLASS i32 (i32.const 4))
  (global $ERR_ESCAPE i32 (i32.const 5))
  (global $ERR_PROGRAM i32 (i32.const 6))
  (global $ERR_QUANT i32 (i32.const 7))
  (global $ERR_STEPS i32 (i32.const 8))
  (global $ERR_PATTERN i32 (i32.const 9))
  (global $ERR_TEXT i32 (i32.const 10))
  (global $ERR_COMPILED i32 (i32.const 11))
  (global $ERR_STACK i32 (i32.const 12))

  (global $pat_len (mut i32) (i32.const 0))
  (global $pat_pos (mut i32) (i32.const 0))
  (global $pc (mut i32) (i32.const 0))
  (global $class_count (mut i32) (i32.const 0))
  (global $text_len (mut i32) (i32.const 0))
  (global $compiled (mut i32) (i32.const 0))
  (global $err (mut i32) (i32.const 0))
  (global $err_pos (mut i32) (i32.const 0))
  (global $steps (mut i32) (i32.const 0))

  ;; Байт паттерна или -1 за пределами.
  (func $pat_at (param $i i32) (result i32)
    (if (result i32)
      (i32.and (i32.ge_s (local.get $i) (i32.const 0))
               (i32.lt_s (local.get $i) (global.get $pat_len)))
      (then (i32.load8_u (i32.add (global.get $PATTERN) (local.get $i))))
      (else (i32.const -1))))

  (func $peek (result i32)
    (call $pat_at (global.get $pat_pos)))

  (func $take (result i32) (local $c i32)
    (if (i32.ge_s (global.get $pat_pos) (global.get $pat_len))
      (then (return (i32.const -1))))
    (local.set $c (i32.load8_u (i32.add (global.get $PATTERN) (global.get $pat_pos))))
    (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
    (local.get $c))

  (func $take_if (param $c i32) (result i32)
    (if (i32.eq (call $peek) (local.get $c))
      (then
        (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
        (return (i32.const 1))))
    (i32.const 0))

  (func $fail (param $code i32) (param $pos i32)
    (if (i32.eqz (global.get $err))
      (then
        (global.set $err (local.get $code))
        (global.set $err_pos (local.get $pos)))))

  ;; Битовая карта класса: classes[cls*32 + c/8] |= 1 << (c%8).
  (func $class_add (param $cls i32) (param $lo i32) (param $hi i32)
    (local $c i32) (local $at i32) (local $bit i32)
    (if (i32.lt_s (local.get $lo) (i32.const 0))
      (then (local.set $lo (i32.const 0))))
    (if (i32.gt_s (local.get $hi) (i32.const 255))
      (then (local.set $hi (i32.const 255))))
    (local.set $c (local.get $lo))
    (block $done
      (loop $loop
        (br_if $done (i32.gt_s (local.get $c) (local.get $hi)))
        (local.set $at
          (i32.add (i32.mul (local.get $cls) (i32.const 32))
                   (i32.shr_s (local.get $c) (i32.const 3))))
        (local.set $bit (i32.shl (i32.const 1) (i32.and (local.get $c) (i32.const 7))))
        (i32.store8
          (i32.add (global.get $CLASSES) (local.get $at))
          (i32.or (i32.load8_u (i32.add (global.get $CLASSES) (local.get $at)))
                  (local.get $bit)))
        (local.set $c (i32.add (local.get $c) (i32.const 1)))
        (br $loop))))

  (func $class_new (result i32) (local $cls i32) (local $i i32)
    (if (i32.ge_s (global.get $class_count) (i32.const 64))
      (then
        (call $fail (global.get $ERR_PROGRAM) (global.get $pat_pos))
        (return (i32.const -1))))
    (local.set $cls (global.get $class_count))
    (global.set $class_count (i32.add (global.get $class_count) (i32.const 1)))
    (local.set $i (i32.const 0))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_s (local.get $i) (i32.const 32)))
        (i32.store8
          (i32.add (global.get $CLASSES)
            (i32.add (i32.mul (local.get $cls) (i32.const 32)) (local.get $i)))
          (i32.const 0))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)))
    (local.get $cls))

  (func $scan_class_end (param $start i32) (result i32) (local $i i32) (local $c i32)
    (local.set $i (i32.add (local.get $start) (i32.const 1)))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_s (local.get $i) (global.get $pat_len)))
        (local.set $c (i32.load8_u (i32.add (global.get $PATTERN) (local.get $i))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $i (i32.add (local.get $i) (i32.const 2)))
            (br $loop)))
        (if (i32.eq (local.get $c) (i32.const 93))
          (then (return (i32.add (local.get $i) (i32.const 1)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)))
    (i32.const -1))

  ;; Позиция сразу за атомом: литералом, классом или группой.
  (func $scan_atom_end (param $start i32) (result i32)
    (local $c i32) (local $i i32) (local $depth i32) (local $d i32)
    (if (i32.ge_s (local.get $start) (global.get $pat_len))
      (then (return (i32.const -1))))
    (local.set $c (i32.load8_u (i32.add (global.get $PATTERN) (local.get $start))))
    (if (i32.eq (local.get $c) (i32.const 91))
      (then (return (call $scan_class_end (local.get $start)))))
    (if (i32.eq (local.get $c) (i32.const 92))
      (then
        (return (if (result i32)
          (i32.le_s (i32.add (local.get $start) (i32.const 2)) (global.get $pat_len))
          (then (i32.add (local.get $start) (i32.const 2)))
          (else (i32.const -1))))))
    (if (i32.eq (local.get $c) (i32.const 40))
      (then
        (local.set $depth (i32.const 0))
        (local.set $i (local.get $start))
        (block $done
          (loop $loop
            (br_if $done (i32.ge_s (local.get $i) (global.get $pat_len)))
            (local.set $d (i32.load8_u (i32.add (global.get $PATTERN) (local.get $i))))
            (if (i32.eq (local.get $d) (i32.const 92))
              (then
                (local.set $i (i32.add (local.get $i) (i32.const 2)))
                (br $loop)))
            (if (i32.eq (local.get $d) (i32.const 91))
              (then
                (local.set $i (call $scan_class_end (local.get $i)))
                (if (i32.lt_s (local.get $i) (i32.const 0))
                  (then (return (i32.const -1))))
                (br $loop)))
            (if (i32.eq (local.get $d) (i32.const 40))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            (if (i32.eq (local.get $d) (i32.const 41))
              (then
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (if (i32.eqz (local.get $depth))
                  (then (return (i32.add (local.get $i) (i32.const 1)))))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)))
        (return (i32.const -1))))
    (i32.add (local.get $start) (i32.const 1)))

  (func $parse_class (result i32)
    (local $start i32) (local $neg i32) (local $cls i32) (local $items i32)
    (local $c i32) (local $single i32) (local $escaped i32) (local $lo i32)
    (local $hi i32) (local $e i32) (local $v i32) (local $i i32) (local $at i32)
    (local.set $start (global.get $pat_pos))
    (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
    (local.set $neg (call $take_if (i32.const 94)))
    (local.set $cls (call $class_new))
    (if (i32.lt_s (local.get $cls) (i32.const 0))
      (then (return (i32.const -1))))
    (local.set $items (i32.const 0))
    (block $done
      (loop $loop
        (local.set $c (call $peek))
        (if (i32.lt_s (local.get $c) (i32.const 0))
          (then
            (call $fail (global.get $ERR_CLASS) (local.get $start))
            (return (i32.const -1))))
        (if (i32.eq (local.get $c) (i32.const 93))
          (then
            (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
            (br $done)))
        (local.set $single (i32.const 0))
        (local.set $escaped (i32.const 0))
        (local.set $lo (i32.const 0))
        (local.set $hi (i32.const 0))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
            (local.set $e (call $take))
            (if (i32.lt_s (local.get $e) (i32.const 0))
              (then
                (call $fail (global.get $ERR_ESCAPE) (global.get $pat_pos))
                (return (i32.const -1))))
            (local.set $escaped (i32.const 1))
            (if (i32.eq (local.get $e) (i32.const 100))
              (then (call $class_add (local.get $cls) (i32.const 48) (i32.const 57)))
              (else
                (if (i32.eq (local.get $e) (i32.const 119))
                  (then
                    (call $class_add (local.get $cls) (i32.const 48) (i32.const 57))
                    (call $class_add (local.get $cls) (i32.const 65) (i32.const 90))
                    (call $class_add (local.get $cls) (i32.const 95) (i32.const 95))
                    (call $class_add (local.get $cls) (i32.const 97) (i32.const 122)))
                  (else
                    (if (i32.eq (local.get $e) (i32.const 115))
                      (then
                        (call $class_add (local.get $cls) (i32.const 9) (i32.const 13))
                        (call $class_add (local.get $cls) (i32.const 32) (i32.const 32)))
                      (else
                        (local.set $single (i32.const 1))
                        (local.set $v (local.get $e))
                        (if (i32.eq (local.get $e) (i32.const 110))
                          (then (local.set $v (i32.const 10))))
                        (if (i32.eq (local.get $e) (i32.const 116))
                          (then (local.set $v (i32.const 9))))
                        (if (i32.eq (local.get $e) (i32.const 114))
                          (then (local.set $v (i32.const 13))))
                        (if (i32.eq (local.get $e) (i32.const 102))
                          (then (local.set $v (i32.const 12))))
                        (if (i32.eq (local.get $e) (i32.const 118))
                          (then (local.set $v (i32.const 11))))
                        (local.set $lo (local.get $v))
                        (local.set $hi (local.get $v)))))))))
          (else
            (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
            (local.set $lo (local.get $c))
            (local.set $hi (local.get $c))
            (local.set $single (i32.const 1))))
        (if (i32.and (local.get $single) (i32.eqz (local.get $escaped)))
          (then
            (if (i32.and
                  (i32.eq (call $peek) (i32.const 45))
                  (i32.and
                    (i32.ne (call $pat_at (i32.add (global.get $pat_pos) (i32.const 1))) (i32.const 93))
                    (i32.ge_s (call $pat_at (i32.add (global.get $pat_pos) (i32.const 1))) (i32.const 0))))
              (then
                (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
                (local.set $e (call $take))
                (if (i32.lt_s (local.get $e) (i32.const 0))
                  (then
                    (call $fail (global.get $ERR_ESCAPE) (global.get $pat_pos))
                    (return (i32.const -1))))
                (if (i32.eq (local.get $e) (i32.const 92))
                  (then
                    (local.set $e (call $take))
                    (if (i32.lt_s (local.get $e) (i32.const 0))
                      (then
                        (call $fail (global.get $ERR_ESCAPE) (global.get $pat_pos))
                        (return (i32.const -1))))))
                (local.set $hi (local.get $e))
                (if (i32.lt_s (local.get $hi) (local.get $lo))
                  (then
                    (call $fail (global.get $ERR_CLASS)
                      (i32.sub (global.get $pat_pos) (i32.const 1)))
                    (return (i32.const -1))))))))
        (if (local.get $single)
          (then (call $class_add (local.get $cls) (local.get $lo) (local.get $hi))))
        (local.set $items (i32.add (local.get $items) (i32.const 1)))
        (br $loop)))
    (if (i32.eqz (local.get $items))
      (then
        (call $fail (global.get $ERR_CLASS) (local.get $start))
        (return (i32.const -1))))
    (if (local.get $neg)
      (then
        (local.set $i (i32.const 0))
        (block $neg_done
          (loop $neg_loop
            (br_if $neg_done (i32.ge_s (local.get $i) (i32.const 32)))
            (local.set $at
              (i32.add (i32.mul (local.get $cls) (i32.const 32)) (local.get $i)))
            (i32.store8
              (i32.add (global.get $CLASSES) (local.get $at))
              (i32.xor
                (i32.load8_u (i32.add (global.get $CLASSES) (local.get $at)))
                (i32.const 255)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $neg_loop)))))
    (local.get $cls))

  (func $emit (param $op i32) (param $a i32) (param $b i32) (result i32)
    (local $at i32) (local $base i32)
    (if (i32.ge_s (global.get $pc) (i32.const 2048))
      (then
        (call $fail (global.get $ERR_PROGRAM) (global.get $pat_pos))
        (return (i32.const -1))))
    (local.set $at (global.get $pc))
    (global.set $pc (i32.add (global.get $pc) (i32.const 1)))
    (local.set $base (i32.add (global.get $PROG) (i32.mul (local.get $at) (i32.const 16))))
    (i32.store (local.get $base) (local.get $op))
    (i32.store (i32.add (local.get $base) (i32.const 4)) (local.get $a))
    (i32.store (i32.add (local.get $base) (i32.const 8)) (local.get $b))
    (i32.store (i32.add (local.get $base) (i32.const 12)) (i32.const 0))
    (local.get $at))

  (func $patch (param $at i32) (param $field i32) (param $value i32)
    (i32.store
      (i32.add (global.get $PROG)
        (i32.add (i32.mul (local.get $at) (i32.const 16))
                 (i32.mul (local.get $field) (i32.const 4))))
      (local.get $value)))

  (func $is_quant (param $c i32) (result i32)
    (i32.or (i32.eq (local.get $c) (i32.const 42))
      (i32.or (i32.eq (local.get $c) (i32.const 43))
              (i32.eq (local.get $c) (i32.const 63)))))

  (func $has_alt (param $from i32) (result i32)
    (local $i i32) (local $depth i32) (local $c i32)
    (local.set $i (local.get $from))
    (local.set $depth (i32.const 0))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_s (local.get $i) (global.get $pat_len)))
        (local.set $c (i32.load8_u (i32.add (global.get $PATTERN) (local.get $i))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $i (i32.add (local.get $i) (i32.const 2)))
            (br $loop)))
        (if (i32.eq (local.get $c) (i32.const 91))
          (then
            (local.set $i (call $scan_class_end (local.get $i)))
            (if (i32.lt_s (local.get $i) (i32.const 0))
              (then (br $done)))
            (br $loop)))
        (if (i32.eq (local.get $c) (i32.const 40))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)))
        (if (i32.eq (local.get $c) (i32.const 41))
          (then
            (if (i32.eqz (local.get $depth))
              (then (br $done)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)))
        (if (i32.and (i32.eq (local.get $c) (i32.const 124))
                     (i32.eqz (local.get $depth)))
          (then (return (i32.const 1))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)))
    (i32.const 0))

  (func $compile_atom (result i32)
    (local $c i32) (local $start i32) (local $e i32) (local $cls i32)
    (local.set $c (call $peek))
    (if (i32.lt_s (local.get $c) (i32.const 0))
      (then
        (call $fail (global.get $ERR_CHAR) (global.get $pat_pos))
        (return (i32.const -1))))
    (if (i32.eq (local.get $c) (i32.const 40))
      (then
        (local.set $start (global.get $pat_pos))
        (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
        (if (i32.lt_s (call $compile_alt) (i32.const 0))
          (then (return (i32.const -1))))
        (if (i32.eqz (call $take_if (i32.const 41)))
          (then
            (call $fail (global.get $ERR_OPEN) (local.get $start))
            (return (i32.const -1))))
        (return (i32.const 1))))
    (if (i32.eq (local.get $c) (i32.const 91))
      (then
        (local.set $cls (call $parse_class))
        (if (i32.lt_s (local.get $cls) (i32.const 0))
          (then (return (i32.const -1))))
        (return (if (result i32)
          (i32.lt_s (call $emit (i32.const 3) (local.get $cls) (i32.const 0)) (i32.const 0))
          (then (i32.const -1)) (else (i32.const 1))))))
    (if (i32.eq (local.get $c) (i32.const 46))
      (then
        (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
        (return (if (result i32)
          (i32.lt_s (call $emit (i32.const 2) (i32.const 0) (i32.const 0)) (i32.const 0))
          (then (i32.const -1)) (else (i32.const 1))))))
    (if (i32.eq (local.get $c) (i32.const 94))
      (then
        (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
        (return (if (result i32)
          (i32.lt_s (call $emit (i32.const 4) (i32.const 0) (i32.const 0)) (i32.const 0))
          (then (i32.const -1)) (else (i32.const 1))))))
    (if (i32.eq (local.get $c) (i32.const 36))
      (then
        (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
        (return (if (result i32)
          (i32.lt_s (call $emit (i32.const 5) (i32.const 0) (i32.const 0)) (i32.const 0))
          (then (i32.const -1)) (else (i32.const 1))))))
    (if (i32.eq (local.get $c) (i32.const 92))
      (then
        (local.set $start (global.get $pat_pos))
        (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
        (local.set $e (call $take))
        (if (i32.lt_s (local.get $e) (i32.const 0))
          (then
            (call $fail (global.get $ERR_ESCAPE) (local.get $start))
            (return (i32.const -1))))
        (if (i32.or (i32.eq (local.get $e) (i32.const 100))
          (i32.or (i32.eq (local.get $e) (i32.const 119))
                  (i32.eq (local.get $e) (i32.const 115))))
          (then
            (local.set $cls (call $class_new))
            (if (i32.lt_s (local.get $cls) (i32.const 0))
              (then (return (i32.const -1))))
            (if (i32.eq (local.get $e) (i32.const 100))
              (then (call $class_add (local.get $cls) (i32.const 48) (i32.const 57))))
            (if (i32.eq (local.get $e) (i32.const 119))
              (then
                (call $class_add (local.get $cls) (i32.const 48) (i32.const 57))
                (call $class_add (local.get $cls) (i32.const 65) (i32.const 90))
                (call $class_add (local.get $cls) (i32.const 95) (i32.const 95))
                (call $class_add (local.get $cls) (i32.const 97) (i32.const 122))))
            (if (i32.eq (local.get $e) (i32.const 115))
              (then
                (call $class_add (local.get $cls) (i32.const 9) (i32.const 13))
                (call $class_add (local.get $cls) (i32.const 32) (i32.const 32))))
            (return (if (result i32)
              (i32.lt_s (call $emit (i32.const 3) (local.get $cls) (i32.const 0)) (i32.const 0))
              (then (i32.const -1)) (else (i32.const 1))))))
        (if (i32.eq (local.get $e) (i32.const 110)) (then (local.set $e (i32.const 10))))
        (if (i32.eq (local.get $e) (i32.const 116)) (then (local.set $e (i32.const 9))))
        (if (i32.eq (local.get $e) (i32.const 114)) (then (local.set $e (i32.const 13))))
        (if (i32.eq (local.get $e) (i32.const 102)) (then (local.set $e (i32.const 12))))
        (if (i32.eq (local.get $e) (i32.const 118)) (then (local.set $e (i32.const 11))))
        (return (if (result i32)
          (i32.lt_s (call $emit (i32.const 1) (local.get $e) (i32.const 0)) (i32.const 0))
          (then (i32.const -1)) (else (i32.const 1))))))
    (if (i32.or (i32.eq (local.get $c) (i32.const 42))
      (i32.or (i32.eq (local.get $c) (i32.const 43))
              (i32.eq (local.get $c) (i32.const 63))))
      (then
        (call $fail (global.get $ERR_QUANT) (global.get $pat_pos))
        (return (i32.const -1))))
    (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
    (return (if (result i32)
      (i32.lt_s (call $emit (i32.const 1) (local.get $c) (i32.const 0)) (i32.const 0))
      (then (i32.const -1)) (else (i32.const 1)))))

  (func $compile_seq (result i32)
    (local $c i32) (local $start i32) (local $end i32) (local $q i32)
    (local $split i32) (local $child i32)
    (block $done
      (loop $loop
        (local.set $c (call $peek))
        (if (i32.or (i32.lt_s (local.get $c) (i32.const 0))
          (i32.or (i32.eq (local.get $c) (i32.const 124))
                  (i32.eq (local.get $c) (i32.const 41))))
          (then (return (i32.const 1))))
        (local.set $start (global.get $pat_pos))
        (local.set $end (call $scan_atom_end (local.get $start)))
        (local.set $q (if (result i32)
          (i32.gt_s (local.get $end) (i32.const 0))
          (then (call $pat_at (local.get $end)))
          (else (i32.const -1))))
        (if (i32.eqz (call $is_quant (local.get $q)))
          (then (local.set $q (i32.const 0))))
        (if (i32.and (i32.ne (local.get $q) (i32.const 0))
          (i32.or (i32.eq (local.get $c) (i32.const 94))
                  (i32.eq (local.get $c) (i32.const 36))))
          (then
            (call $fail (global.get $ERR_QUANT) (local.get $end))
            (return (i32.const -1))))
        (local.set $split (i32.const -1))
        (if (i32.or (i32.eq (local.get $q) (i32.const 42))
                    (i32.eq (local.get $q) (i32.const 63)))
          (then
            (local.set $split
              (call $emit (i32.const 7)
                (i32.add (global.get $pc) (i32.const 1)) (i32.const 0)))
            (if (i32.lt_s (local.get $split) (i32.const 0))
              (then (return (i32.const -1))))))
        (local.set $child (global.get $pc))
        (if (i32.lt_s (call $compile_atom) (i32.const 0))
          (then (return (i32.const -1))))
        (if (i32.eq (local.get $q) (i32.const 42))
          (then
            (if (i32.lt_s (call $emit (i32.const 6) (local.get $split) (i32.const 0)) (i32.const 0))
              (then (return (i32.const -1))))
            (call $patch (local.get $split) (i32.const 2) (global.get $pc))))
        (if (i32.eq (local.get $q) (i32.const 63))
          (then (call $patch (local.get $split) (i32.const 2) (global.get $pc))))
        (if (i32.eq (local.get $q) (i32.const 43))
          (then
            (local.set $split (call $emit (i32.const 7) (local.get $child) (i32.const 0)))
            (if (i32.lt_s (local.get $split) (i32.const 0))
              (then (return (i32.const -1))))
            (call $patch (local.get $split) (i32.const 2) (global.get $pc))))
        (if (i32.ne (local.get $q) (i32.const 0))
          (then
            (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
            (if (call $is_quant (call $peek))
              (then
                (call $fail (global.get $ERR_QUANT) (global.get $pat_pos))
                (return (i32.const -1))))))
        (br $loop))))

  (func $compile_alt (result i32)
    (local $split i32) (local $jmp i32)
    (if (i32.eqz (call $has_alt (global.get $pat_pos)))
      (then (return (call $compile_seq))))
    (local.set $split
      (call $emit (i32.const 7) (i32.add (global.get $pc) (i32.const 1)) (i32.const 0)))
    (if (i32.lt_s (local.get $split) (i32.const 0))
      (then (return (i32.const -1))))
    (if (i32.lt_s (call $compile_seq) (i32.const 0))
      (then (return (i32.const -1))))
    (if (i32.eq (call $peek) (i32.const 124))
      (then
        (global.set $pat_pos (i32.add (global.get $pat_pos) (i32.const 1)))
        (local.set $jmp (call $emit (i32.const 6) (i32.const 0) (i32.const 0)))
        (if (i32.lt_s (local.get $jmp) (i32.const 0))
          (then (return (i32.const -1))))
        (call $patch (local.get $split) (i32.const 2) (global.get $pc))
        (if (i32.lt_s (call $compile_alt) (i32.const 0))
          (then (return (i32.const -1))))
        (call $patch (local.get $jmp) (i32.const 1) (global.get $pc)))
      (else
        (call $patch (local.get $split) (i32.const 2) (global.get $pc))))
    (i32.const 1))

  (func $class_has (param $cls i32) (param $c i32) (result i32)
    (local $at i32)
    (local.set $at
      (i32.add (i32.mul (local.get $cls) (i32.const 32))
               (i32.shr_s (local.get $c) (i32.const 3))))
    (i32.and
      (i32.shr_u
        (i32.load8_u (i32.add (global.get $CLASSES) (local.get $at)))
        (i32.and (local.get $c) (i32.const 7)))
      (i32.const 1)))

  (func $re_pattern_ptr (export "re_pattern_ptr") (result i32)
    (global.get $PATTERN))

  (func $re_text_ptr (export "re_text_ptr") (result i32)
    (global.get $TEXT))

  (func $re_error (export "re_error") (result i32)
    (global.get $err))

  (func $re_error_pos (export "re_error_pos") (result i32)
    (global.get $err_pos))

  (func $re_steps (export "re_steps") (result i32)
    (global.get $steps))

  (func $re_compile (export "re_compile") (param $len i32) (result i32)
    (local $root i32)
    (global.set $err (i32.const 0))
    (global.set $err_pos (i32.const 0))
    (global.set $compiled (i32.const 0))
    (global.set $pat_pos (i32.const 0))
    (global.set $pc (i32.const 0))
    (global.set $class_count (i32.const 0))
    (if (i32.or (i32.lt_s (local.get $len) (i32.const 0))
                (i32.gt_s (local.get $len) (i32.const 4096)))
      (then
        (global.set $pat_len (i32.const 0))
        (call $fail (global.get $ERR_PATTERN) (i32.const 0))
        (return (global.get $err))))
    (global.set $pat_len (local.get $len))
    (local.set $root (call $compile_alt))
    (if (i32.lt_s (local.get $root) (i32.const 0))
      (then (return (global.get $err))))
    (if (i32.lt_s (global.get $pat_pos) (global.get $pat_len))
      (then
        (if (i32.eq
              (i32.load8_u (i32.add (global.get $PATTERN) (global.get $pat_pos)))
              (i32.const 41))
          (then (call $fail (global.get $ERR_CLOSE) (global.get $pat_pos)))
          (else (call $fail (global.get $ERR_CHAR) (global.get $pat_pos))))
        (return (global.get $err))))
    (if (i32.lt_s (call $emit (i32.const 8) (i32.const 0) (i32.const 0)) (i32.const 0))
      (then (return (global.get $err))))
    (global.set $compiled (i32.const 1))
    (i32.const 0))

  (func $re_match (export "re_match") (param $len i32) (result i32)
    (local $start i32) (local $ip i32) (local $pos i32) (local $bt i32)
    (local $op i32) (local $a i32) (local $b i32) (local $base i32)
    (global.set $err (i32.const 0))
    (global.set $err_pos (i32.const 0))
    (global.set $steps (i32.const 0))
    (if (i32.eqz (global.get $compiled))
      (then
        (call $fail (global.get $ERR_COMPILED) (i32.const 0))
        (return (i32.const -1))))
    (if (i32.or (i32.lt_s (local.get $len) (i32.const 0))
                (i32.gt_s (local.get $len) (i32.const 8192)))
      (then
        (call $fail (global.get $ERR_TEXT) (i32.const 0))
        (return (i32.const -1))))
    (global.set $text_len (local.get $len))
    (local.set $start (i32.const 0))
    (block $done
      (loop $start_loop
        (br_if $done (i32.gt_s (local.get $start) (local.get $len)))
        (local.set $ip (i32.const 0))
        (local.set $pos (local.get $start))
        (local.set $bt (i32.const 0))
        (block $next_start
          (loop $step
            (global.set $steps (i32.add (global.get $steps) (i32.const 1)))
            (if (i32.gt_s (global.get $steps) (i32.const 1000000))
              (then
                (call $fail (global.get $ERR_STEPS) (local.get $pos))
                (return (i32.const -1))))
            (local.set $base
              (i32.add (global.get $PROG) (i32.mul (local.get $ip) (i32.const 16))))
            (local.set $op (i32.load (local.get $base)))
            (local.set $a (i32.load (i32.add (local.get $base) (i32.const 4))))
            (local.set $b (i32.load (i32.add (local.get $base) (i32.const 8))))
            (block $backtrack
              (if (i32.eq (local.get $op) (i32.const 1))
                (then
                  (if (i32.and
                        (i32.lt_s (local.get $pos) (local.get $len))
                        (i32.eq
                          (i32.load8_u (i32.add (global.get $TEXT) (local.get $pos)))
                          (local.get $a)))
                    (then
                      (local.set $pos (i32.add (local.get $pos) (i32.const 1)))
                      (local.set $ip (i32.add (local.get $ip) (i32.const 1)))
                      (br $step))
                    (else (br $backtrack)))))
              (if (i32.eq (local.get $op) (i32.const 2))
                (then
                  (if (i32.and
                        (i32.lt_s (local.get $pos) (local.get $len))
                        (i32.ne
                          (i32.load8_u (i32.add (global.get $TEXT) (local.get $pos)))
                          (i32.const 10)))
                    (then
                      (local.set $pos (i32.add (local.get $pos) (i32.const 1)))
                      (local.set $ip (i32.add (local.get $ip) (i32.const 1)))
                      (br $step))
                    (else (br $backtrack)))))
              (if (i32.eq (local.get $op) (i32.const 3))
                (then
                  (if (i32.and
                        (i32.lt_s (local.get $pos) (local.get $len))
                        (call $class_has (local.get $a)
                          (i32.load8_u (i32.add (global.get $TEXT) (local.get $pos)))))
                    (then
                      (local.set $pos (i32.add (local.get $pos) (i32.const 1)))
                      (local.set $ip (i32.add (local.get $ip) (i32.const 1)))
                      (br $step))
                    (else (br $backtrack)))))
              (if (i32.eq (local.get $op) (i32.const 4))
                (then
                  (if (i32.eqz (local.get $pos))
                    (then
                      (local.set $ip (i32.add (local.get $ip) (i32.const 1)))
                      (br $step))
                    (else (br $backtrack)))))
              (if (i32.eq (local.get $op) (i32.const 5))
                (then
                  (if (i32.eq (local.get $pos) (local.get $len))
                    (then
                      (local.set $ip (i32.add (local.get $ip) (i32.const 1)))
                      (br $step))
                    (else (br $backtrack)))))
              (if (i32.eq (local.get $op) (i32.const 6))
                (then
                  (local.set $ip (local.get $a))
                  (br $step)))
              (if (i32.eq (local.get $op) (i32.const 7))
                (then
                  (if (i32.ge_s (local.get $bt) (i32.const 8192))
                    (then
                      (call $fail (global.get $ERR_STACK) (local.get $pos))
                      (return (i32.const -1))))
                  (i32.store
                    (i32.add (global.get $BT_PC) (i32.mul (local.get $bt) (i32.const 4)))
                    (local.get $b))
                  (i32.store
                    (i32.add (global.get $BT_POS) (i32.mul (local.get $bt) (i32.const 4)))
                    (local.get $pos))
                  (local.set $bt (i32.add (local.get $bt) (i32.const 1)))
                  (local.set $ip (local.get $a))
                  (br $step)))
              (if (i32.eq (local.get $op) (i32.const 8))
                (then (return (i32.const 1))))
              (br $backtrack))
            (if (i32.eqz (local.get $bt))
              (then (br $next_start)))
            (local.set $bt (i32.sub (local.get $bt) (i32.const 1)))
            (local.set $ip
              (i32.load
                (i32.add (global.get $BT_PC)
                  (i32.mul (local.get $bt) (i32.const 4)))))
            (local.set $pos
              (i32.load
                (i32.add (global.get $BT_POS)
                  (i32.mul (local.get $bt) (i32.const 4)))))
            (br $step)))
        (local.set $start (i32.add (local.get $start) (i32.const 1)))
        (br $start_loop)))
    (i32.const 0)))
