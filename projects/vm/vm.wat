;; Стековая VM: ручной байткод без компилятора.
;;
;; Формат инструкции — 4 байта [op, x, y, z]:
;;   PUSH imm       знаковое 24-битное число в x,y,z
;;   JMP/JZ/JNZ/CALL target   адрес в x | y<<8
;;   LOADL/STOREL n локальный индекс в x
;;
;; Раскладка памяти:
;;   0x0000…0x03ff  резерв (ловушка на нулевой указатель)
;;   0x0400…0x43ff  код: 4096 инструкций × 4 байта
;;   0x4400…0x53ff  стек значений: 1024 × i32
;;   0x5400…0x65ff  кадры: 128 × (адрес возврата + 8 локалов)
;;
;; Семантика совпадает с builds/c/vm.c: проверка программы на загрузке,
;; общий стек значений, локалы на кадр, лимит шагов и защита INT_MIN / −1.

(module
  (memory (export "memory") 1)

  (global $code_len (mut i32) (i32.const 0))
  (global $loaded (mut i32) (i32.const 0))
  (global $sp (mut i32) (i32.const 0))
  (global $fp (mut i32) (i32.const 0))
  (global $pc (mut i32) (i32.const 0))
  (global $err (mut i32) (i32.const 0))
  (global $steps (mut i32) (i32.const 0))
  (global $result (mut i32) (i32.const 0))
  (global $depth (mut i32) (i32.const 0))
  (global $limit (mut i32) (i32.const 0))

  ;; ── служебные ────────────────────────────────────────────────

  (func $push (param $v i32) (result i32)
    (if (i32.ge_s (global.get $sp) (i32.const 1024))
      (then (return (i32.const 3))))
    (i32.store
      (i32.add (i32.const 17408) (i32.mul (global.get $sp) (i32.const 4)))
      (local.get $v))
    (global.set $sp (i32.add (global.get $sp) (i32.const 1)))
    (i32.const 0))

  ;; Фиксирует глубину и вершину стека, возвращает 0/-1.
  (func $stop (result i32)
    (global.set $depth (global.get $sp))
    (global.set $result
      (if (result i32) (i32.gt_s (global.get $sp) (i32.const 0))
        (then
          (i32.load
            (i32.add (i32.const 17408)
              (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4)))))
        (else (i32.const 0))))
    (if (result i32) (i32.eqz (global.get $err))
      (then (i32.const 0))
      (else (i32.const -1))))

  ;; Ошибка времени исполнения: pc откатывается на виновную инструкцию.
  (func $die (param $code i32) (result i32)
    (global.set $err (local.get $code))
    (global.set $pc (i32.sub (global.get $pc) (i32.const 1)))
    (call $stop))

  ;; ── API ──────────────────────────────────────────────────────

  (func (export "vm_code_ptr") (result i32)
    (i32.const 1024))

  (func (export "vm_load") (param $count i32) (result i32)
    (local $i i32)
    (local $base i32)
    (local $op i32)
    (local $target i32)

    (global.set $loaded (i32.const 0))
    (global.set $err (i32.const 0))
    (global.set $pc (i32.const 0))
    (global.set $code_len (i32.const 0))

    (if (i32.gt_s (local.get $count) (i32.const 4096))
      (then (global.set $err (i32.const 8)) (return (i32.const 8))))
    (if (i32.le_s (local.get $count) (i32.const 0))
      (then (global.set $err (i32.const 12)) (return (i32.const 12))))

    (local.set $i (i32.const 0))
    (block $done
      (loop $next
        (br_if $done (i32.ge_s (local.get $i) (local.get $count)))
        (local.set $base
          (i32.add (i32.const 1024) (i32.mul (local.get $i) (i32.const 4))))
        (local.set $op (i32.load8_u (local.get $base)))

        ;; неизвестный опкод
        (if (i32.or (i32.lt_s (local.get $op) (i32.const 1))
                    (i32.gt_s (local.get $op) (i32.const 27)))
          (then
            (global.set $err (i32.const 1))
            (global.set $pc (local.get $i))
            (return (i32.const 1))))

        ;; адрес перехода внутри программы
        (if (i32.or (i32.or (i32.eq (local.get $op) (i32.const 20))
                            (i32.eq (local.get $op) (i32.const 21)))
                    (i32.or (i32.eq (local.get $op) (i32.const 22))
                            (i32.eq (local.get $op) (i32.const 25))))
          (then
            (local.set $target
              (i32.or
                (i32.load8_u (i32.add (local.get $base) (i32.const 1)))
                (i32.shl (i32.load8_u (i32.add (local.get $base) (i32.const 2)))
                         (i32.const 8))))
            (if (i32.ge_u (local.get $target) (local.get $count))
              (then
                (global.set $err (i32.const 6))
                (global.set $pc (local.get $i))
                (return (i32.const 6))))))

        ;; индекс локала
        (if (i32.or (i32.eq (local.get $op) (i32.const 23))
                    (i32.eq (local.get $op) (i32.const 24)))
          (then
            (if (i32.ge_u (i32.load8_u (i32.add (local.get $base) (i32.const 1)))
                         (i32.const 8))
              (then
                (global.set $err (i32.const 10))
                (global.set $pc (local.get $i))
                (return (i32.const 10))))))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))

    (global.set $code_len (local.get $count))
    (global.set $loaded (i32.const 1))
    (i32.const 0))

  (func (export "vm_run") (param $cap i32) (result i32)
    (local $op i32)
    (local $x i32)
    (local $base i32)
    (local $a i32)
    (local $b i32)
    (local $t i32)
    (local $i i32)

    (if (i32.eqz (global.get $loaded))
      (then (global.set $err (i32.const 9)) (return (i32.const -1))))

    (global.set $limit
      (if (result i32) (i32.le_s (local.get $cap) (i32.const 0))
        (then (i32.const 1000000))
        (else (local.get $cap))))

    (global.set $sp (i32.const 0))
    (global.set $fp (i32.const 0))
    (global.set $pc (i32.const 0))
    (global.set $err (i32.const 0))
    (global.set $steps (i32.const 0))
    (global.set $depth (i32.const 0))
    (global.set $result (i32.const 0))

    ;; обнулить локалы главного кадра
    (local.set $i (i32.const 0))
    (block $zl_done
      (loop $zl
        (br_if $zl_done (i32.ge_s (local.get $i) (i32.const 8)))
        (i32.store
          (i32.add (i32.const 21504)
            (i32.mul (i32.add (local.get $i) (i32.const 1)) (i32.const 4)))
          (i32.const 0))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $zl)))

    (loop $loop
      ;; лимит шагов
      (if (i32.ge_s (global.get $steps) (global.get $limit))
        (then (global.set $err (i32.const 7)) (return (call $stop))))

      ;; pc за границей программы
      (if (i32.ge_u (global.get $pc) (global.get $code_len))
        (then (global.set $err (i32.const 6)) (return (call $stop))))

      (local.set $base
        (i32.add (i32.const 1024) (i32.mul (global.get $pc) (i32.const 4))))
      (local.set $op (i32.load8_u (local.get $base)))
      (local.set $x (i32.load8_u (i32.add (local.get $base) (i32.const 1))))
      (global.set $pc (i32.add (global.get $pc) (i32.const 1)))

      (block $continue
        (block $case27
          (block $case26
            (block $case25
              (block $case24
                (block $case23
                  (block $case22
                    (block $case21
                      (block $case20
                        (block $case19
                          (block $case18
                            (block $case17
                              (block $case16
                                (block $case15
                                  (block $case14
                                    (block $case13
                                      (block $case12
                                        (block $case11
                                          (block $case10
                                            (block $case9
                                              (block $case8
                                                (block $case7
                                                  (block $case6
                                                    (block $case5
                                                      (block $case4
                                                        (block $case3
                                                          (block $case2
                                                            (block $case1
                                                              (br_table
                                                                $case1 $case2 $case3 $case4 $case5
                                                                $case6 $case7 $case8 $case9 $case10
                                                                $case11 $case12 $case13 $case14 $case15
                                                                $case16 $case17 $case18 $case19 $case20
                                                                $case21 $case22 $case23 $case24 $case25
                                                                $case26 $case27
                                                                (i32.sub (local.get $op) (i32.const 1)))
                                                            )
                                                            ;; 1 · PUSH imm
                                                            (local.set $a
                                                              (i32.or
                                                                (i32.or
                                                                  (i32.shl (i32.load8_u (i32.add (local.get $base) (i32.const 1))) (i32.const 16))
                                                                  (i32.shl (i32.load8_u (i32.add (local.get $base) (i32.const 2))) (i32.const 8)))
                                                                (i32.load8_u (i32.add (local.get $base) (i32.const 3)))))
                                                            (local.set $a (i32.shr_s (i32.shl (local.get $a) (i32.const 8)) (i32.const 8)))
                                                            (local.set $t (call $push (local.get $a)))
                                                            (if (local.get $t) (then (return (call $die (local.get $t)))))
                                                            (br $continue)
                                                          )
                                                          ;; 2 · POP
                                                          (if (i32.lt_s (global.get $sp) (i32.const 1))
                                                            (then (return (call $die (i32.const 2)))))
                                                          (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                                          (br $continue)
                                                        )
                                                        ;; 3 · DUP
                                                        (if (i32.lt_s (global.get $sp) (i32.const 1))
                                                          (then (return (call $die (i32.const 2)))))
                                                        (local.set $t (call $push
                                                          (i32.load
                                                            (i32.add (i32.const 17408)
                                                              (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))))
                                                        (if (local.get $t) (then (return (call $die (local.get $t)))))
                                                        (br $continue)
                                                      )
                                                      ;; 4 · SWAP
                                                      (if (i32.lt_s (global.get $sp) (i32.const 2))
                                                        (then (return (call $die (i32.const 2)))))
                                                      (local.set $base
                                                        (i32.add (i32.const 17408)
                                                          (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                                      (local.set $a (i32.load (local.get $base)))
                                                      (local.set $b (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                                      (i32.store (local.get $base) (local.get $b))
                                                      (i32.store (i32.sub (local.get $base) (i32.const 4)) (local.get $a))
                                                      (br $continue)
                                                    )
                                                    ;; 5 · ADD
                                                    (if (i32.lt_s (global.get $sp) (i32.const 2))
                                                      (then (return (call $die (i32.const 2)))))
                                                    (local.set $base
                                                      (i32.add (i32.const 17408)
                                                        (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                                    (local.set $b (i32.load (local.get $base)))
                                                    (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                                    (i32.store (i32.sub (local.get $base) (i32.const 4))
                                                      (i32.add (local.get $a) (local.get $b)))
                                                    (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                                    (br $continue)
                                                  )
                                                  ;; 6 · SUB
                                                  (if (i32.lt_s (global.get $sp) (i32.const 2))
                                                    (then (return (call $die (i32.const 2)))))
                                                  (local.set $base
                                                    (i32.add (i32.const 17408)
                                                      (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                                  (local.set $b (i32.load (local.get $base)))
                                                  (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                                  (i32.store (i32.sub (local.get $base) (i32.const 4))
                                                    (i32.sub (local.get $a) (local.get $b)))
                                                  (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                                  (br $continue)
                                                )
                                                ;; 7 · MUL
                                                (if (i32.lt_s (global.get $sp) (i32.const 2))
                                                  (then (return (call $die (i32.const 2)))))
                                                (local.set $base
                                                  (i32.add (i32.const 17408)
                                                    (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                                (local.set $b (i32.load (local.get $base)))
                                                (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                                (i32.store (i32.sub (local.get $base) (i32.const 4))
                                                  (i32.mul (local.get $a) (local.get $b)))
                                                (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                                (br $continue)
                                              )
                                              ;; 8 · DIV
                                              (if (i32.lt_s (global.get $sp) (i32.const 2))
                                                (then (return (call $die (i32.const 2)))))
                                              (local.set $base
                                                (i32.add (i32.const 17408)
                                                  (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                              (local.set $b (i32.load (local.get $base)))
                                              (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                              ;; операнды снимаются до проверки: при ошибке
                                              ;; глубина совпадает с C-референсом
                                              (global.set $sp (i32.sub (global.get $sp) (i32.const 2)))
                                              (if (i32.eqz (local.get $b))
                                                (then (return (call $die (i32.const 5)))))
                                              (local.set $t
                                                (if (result i32)
                                                  (i32.and
                                                    (i32.eq (local.get $a) (i32.const -2147483648))
                                                    (i32.eq (local.get $b) (i32.const -1)))
                                                  (then (local.get $a))
                                                  (else (i32.div_s (local.get $a) (local.get $b)))))
                                              (i32.store
                                                (i32.add (i32.const 17408)
                                                  (i32.mul (global.get $sp) (i32.const 4)))
                                                (local.get $t))
                                              (global.set $sp (i32.add (global.get $sp) (i32.const 1)))
                                              (br $continue)
                                            )
                                            ;; 9 · MOD
                                            (if (i32.lt_s (global.get $sp) (i32.const 2))
                                              (then (return (call $die (i32.const 2)))))
                                            (local.set $base
                                              (i32.add (i32.const 17408)
                                                (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                            (local.set $b (i32.load (local.get $base)))
                                            (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                            (global.set $sp (i32.sub (global.get $sp) (i32.const 2)))
                                            (if (i32.eqz (local.get $b))
                                              (then (return (call $die (i32.const 5)))))
                                            (i32.store
                                              (i32.add (i32.const 17408)
                                                (i32.mul (global.get $sp) (i32.const 4)))
                                              (i32.rem_s (local.get $a) (local.get $b)))
                                            (global.set $sp (i32.add (global.get $sp) (i32.const 1)))
                                            (br $continue)
                                          )
                                          ;; 10 · NEG
                                          (if (i32.lt_s (global.get $sp) (i32.const 1))
                                            (then (return (call $die (i32.const 2)))))
                                          (local.set $base
                                            (i32.add (i32.const 17408)
                                              (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                          (i32.store (local.get $base)
                                            (i32.sub (i32.const 0) (i32.load (local.get $base))))
                                          (br $continue)
                                        )
                                        ;; 11 · EQ
                                        (if (i32.lt_s (global.get $sp) (i32.const 2))
                                          (then (return (call $die (i32.const 2)))))
                                        (local.set $base
                                          (i32.add (i32.const 17408)
                                            (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                        (local.set $b (i32.load (local.get $base)))
                                        (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                        (i32.store (i32.sub (local.get $base) (i32.const 4))
                                          (i32.eq (local.get $a) (local.get $b)))
                                        (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                        (br $continue)
                                      )
                                      ;; 12 · NE
                                      (if (i32.lt_s (global.get $sp) (i32.const 2))
                                        (then (return (call $die (i32.const 2)))))
                                      (local.set $base
                                        (i32.add (i32.const 17408)
                                          (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                      (local.set $b (i32.load (local.get $base)))
                                      (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                      (i32.store (i32.sub (local.get $base) (i32.const 4))
                                        (i32.ne (local.get $a) (local.get $b)))
                                      (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                      (br $continue)
                                    )
                                    ;; 13 · LT
                                    (if (i32.lt_s (global.get $sp) (i32.const 2))
                                      (then (return (call $die (i32.const 2)))))
                                    (local.set $base
                                      (i32.add (i32.const 17408)
                                        (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                    (local.set $b (i32.load (local.get $base)))
                                    (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                    (i32.store (i32.sub (local.get $base) (i32.const 4))
                                      (i32.lt_s (local.get $a) (local.get $b)))
                                    (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                    (br $continue)
                                  )
                                  ;; 14 · LE
                                  (if (i32.lt_s (global.get $sp) (i32.const 2))
                                    (then (return (call $die (i32.const 2)))))
                                  (local.set $base
                                    (i32.add (i32.const 17408)
                                      (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                  (local.set $b (i32.load (local.get $base)))
                                  (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                  (i32.store (i32.sub (local.get $base) (i32.const 4))
                                    (i32.le_s (local.get $a) (local.get $b)))
                                  (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                  (br $continue)
                                )
                                ;; 15 · GT
                                (if (i32.lt_s (global.get $sp) (i32.const 2))
                                  (then (return (call $die (i32.const 2)))))
                                (local.set $base
                                  (i32.add (i32.const 17408)
                                    (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                                (local.set $b (i32.load (local.get $base)))
                                (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                                (i32.store (i32.sub (local.get $base) (i32.const 4))
                                  (i32.gt_s (local.get $a) (local.get $b)))
                                (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                                (br $continue)
                              )
                              ;; 16 · GE
                              (if (i32.lt_s (global.get $sp) (i32.const 2))
                                (then (return (call $die (i32.const 2)))))
                              (local.set $base
                                (i32.add (i32.const 17408)
                                  (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                              (local.set $b (i32.load (local.get $base)))
                              (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                              (i32.store (i32.sub (local.get $base) (i32.const 4))
                                (i32.ge_s (local.get $a) (local.get $b)))
                              (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                              (br $continue)
                            )
                            ;; 17 · AND
                            (if (i32.lt_s (global.get $sp) (i32.const 2))
                              (then (return (call $die (i32.const 2)))))
                            (local.set $base
                              (i32.add (i32.const 17408)
                                (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                            (local.set $b (i32.load (local.get $base)))
                            (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                            (i32.store (i32.sub (local.get $base) (i32.const 4))
                              (i32.and (i32.ne (local.get $a) (i32.const 0))
                                       (i32.ne (local.get $b) (i32.const 0))))
                            (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                            (br $continue)
                          )
                          ;; 18 · OR
                          (if (i32.lt_s (global.get $sp) (i32.const 2))
                            (then (return (call $die (i32.const 2)))))
                          (local.set $base
                            (i32.add (i32.const 17408)
                              (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                          (local.set $b (i32.load (local.get $base)))
                          (local.set $a (i32.load (i32.sub (local.get $base) (i32.const 4))))
                          (i32.store (i32.sub (local.get $base) (i32.const 4))
                            (i32.or (i32.ne (local.get $a) (i32.const 0))
                                    (i32.ne (local.get $b) (i32.const 0))))
                          (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                          (br $continue)
                        )
                        ;; 19 · NOT
                        (if (i32.lt_s (global.get $sp) (i32.const 1))
                          (then (return (call $die (i32.const 2)))))
                        (local.set $base
                          (i32.add (i32.const 17408)
                            (i32.mul (i32.sub (global.get $sp) (i32.const 1)) (i32.const 4))))
                        (i32.store (local.get $base)
                          (i32.eqz (i32.load (local.get $base))))
                        (br $continue)
                      )
                      ;; 20 · JMP
                      (global.set $pc
                        (i32.or
                          (i32.load8_u (i32.add (local.get $base) (i32.const 1)))
                          (i32.shl (i32.load8_u (i32.add (local.get $base) (i32.const 2)))
                                   (i32.const 8))))
                      (br $continue)
                    )
                    ;; 21 · JZ
                    (if (i32.lt_s (global.get $sp) (i32.const 1))
                      (then (return (call $die (i32.const 2)))))
                    (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                    (local.set $a
                      (i32.load
                        (i32.add (i32.const 17408)
                          (i32.mul (global.get $sp) (i32.const 4)))))
                    (if (i32.eqz (local.get $a))
                      (then
                        (global.set $pc
                          (i32.or
                            (i32.load8_u (i32.add (local.get $base) (i32.const 1)))
                            (i32.shl (i32.load8_u (i32.add (local.get $base) (i32.const 2)))
                                     (i32.const 8))))))
                    (br $continue)
                  )
                  ;; 22 · JNZ
                  (if (i32.lt_s (global.get $sp) (i32.const 1))
                    (then (return (call $die (i32.const 2)))))
                  (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
                  (local.set $a
                    (i32.load
                      (i32.add (i32.const 17408)
                        (i32.mul (global.get $sp) (i32.const 4)))))
                  (if (local.get $a)
                    (then
                      (global.set $pc
                        (i32.or
                          (i32.load8_u (i32.add (local.get $base) (i32.const 1)))
                          (i32.shl (i32.load8_u (i32.add (local.get $base) (i32.const 2)))
                                   (i32.const 8))))))
                  (br $continue)
                )
                ;; 23 · LOADL
                (local.set $t
                  (call $push
                    (i32.load
                      (i32.add (i32.const 21504)
                        (i32.mul
                          (i32.add
                            (i32.mul (global.get $fp) (i32.const 9))
                            (i32.add (local.get $x) (i32.const 1)))
                          (i32.const 4))))))
                (if (local.get $t) (then (return (call $die (local.get $t)))))
                (br $continue)
              )
              ;; 24 · STOREL
              (if (i32.lt_s (global.get $sp) (i32.const 1))
                (then (return (call $die (i32.const 2)))))
              (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
              (local.set $a
                (i32.load
                  (i32.add (i32.const 17408)
                    (i32.mul (global.get $sp) (i32.const 4)))))
              (i32.store
                (i32.add (i32.const 21504)
                  (i32.mul
                    (i32.add
                      (i32.mul (global.get $fp) (i32.const 9))
                      (i32.add (local.get $x) (i32.const 1)))
                    (i32.const 4)))
                (local.get $a))
              (br $continue)
            )
            ;; 25 · CALL
            (if (i32.ge_s (i32.add (global.get $fp) (i32.const 1)) (i32.const 128))
              (then (return (call $die (i32.const 4)))))
            (global.set $fp (i32.add (global.get $fp) (i32.const 1)))
            (i32.store
              (i32.add (i32.const 21504)
                (i32.mul (global.get $fp) (i32.const 36)))
              (global.get $pc))
            (local.set $i (i32.const 0))
            (block $call_done
              (loop $call_zero
                (br_if $call_done (i32.ge_s (local.get $i) (i32.const 8)))
                (i32.store
                  (i32.add (i32.const 21504)
                    (i32.mul
                      (i32.add
                        (i32.mul (global.get $fp) (i32.const 9))
                        (i32.add (local.get $i) (i32.const 1)))
                      (i32.const 4)))
                  (i32.const 0))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $call_zero)))
            (global.set $pc
              (i32.or
                (i32.load8_u (i32.add (local.get $base) (i32.const 1)))
                (i32.shl (i32.load8_u (i32.add (local.get $base) (i32.const 2)))
                         (i32.const 8))))
            (br $continue)
          )
          ;; 26 · RET
          (if (i32.eqz (global.get $fp))
            (then (return (call $die (i32.const 11)))))
          (global.set $pc
            (i32.load
              (i32.add (i32.const 21504)
                (i32.mul (global.get $fp) (i32.const 36)))))
          (global.set $fp (i32.sub (global.get $fp) (i32.const 1)))
          (br $continue)
        )
        ;; 27 · HALT
        (global.set $steps (i32.add (global.get $steps) (i32.const 1)))
        (return (call $stop))
      )

      (global.set $steps (i32.add (global.get $steps) (i32.const 1)))
      (br $loop))

    (call $stop))

  (func (export "vm_result") (result i32) (global.get $result))
  (func (export "vm_depth") (result i32) (global.get $depth))
  (func (export "vm_error") (result i32) (global.get $err))
  (func (export "vm_pc") (result i32) (global.get $pc))
  (func (export "vm_steps") (result i32) (global.get $steps))
)
