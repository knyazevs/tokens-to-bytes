(module
  (global $acc (mut f64) (f64.const 0))
  (global $cur (mut f64) (f64.const 0))
  (global $scale (mut f64) (f64.const 1))
  (global $last (mut f64) (f64.const 0))
  (global $op (mut i32) (i32.const 0))
  (global $lastOp (mut i32) (i32.const 0))
  (global $startNew (mut i32) (i32.const 1))
  (global $frac (mut i32) (i32.const 0))
  (global $digits (mut i32) (i32.const 0))
  (global $err (mut i32) (i32.const 0))
  (global $operand (mut f64) (f64.const 0))
  (global $left (mut f64) (f64.const 0))

  (func $clear (export "clear")
    (global.set $cur (f64.const 0))
    (global.set $scale (f64.const 1))
    (global.set $last (f64.const 0))
    (global.set $startNew (i32.const 1))
    (global.set $frac (i32.const 0))
    (global.set $digits (i32.const 0))
    (global.set $acc (f64.const 0))
    (global.set $op (i32.const 0))
    (global.set $lastOp (i32.const 0))
    (global.set $err (i32.const 0))
    (global.set $operand (f64.const 0))
    (global.set $left (f64.const 0)))

  (func $ce (export "ce")
    (global.set $cur (f64.const 0))
    (global.set $scale (f64.const 1))
    (global.set $last (f64.const 0))
    (global.set $startNew (i32.const 1))
    (global.set $frac (i32.const 0))
    (global.set $digits (i32.const 0))
    (global.set $err (i32.const 0)))

  (func $digit (export "digit") (param $n i32)
    (local $v f64)
    (local $c f64)
    (local $s f64)
    (local $term f64)
    (if (global.get $err) (then (call $clear)))
    (local.set $v (f64.convert_i32_s (local.get $n)))
    (if (global.get $startNew)
      (then
        (global.set $cur (local.get $v))
        (global.set $last (local.get $v))
        (global.set $frac (i32.const 0))
        (global.set $scale (f64.const 1))
        (global.set $digits (i32.const 0))
        (global.set $startNew (i32.const 0))
        (return)))
    (local.set $c (global.get $cur))
    (if (i32.eqz (global.get $frac))
      (then
        (global.set $cur
          (if (result f64) (f64.lt (local.get $c) (f64.const 0))
            (then (f64.sub (f64.mul (local.get $c) (f64.const 10)) (local.get $v)))
            (else (f64.add (f64.mul (local.get $c) (f64.const 10)) (local.get $v))))))
      (else
        (local.set $s (f64.mul (global.get $scale) (f64.const 0.1)))
        (global.set $scale (local.get $s))
        (local.set $term (f64.mul (local.get $v) (local.get $s)))
        (global.set $cur
          (if (result f64) (f64.lt (local.get $c) (f64.const 0))
            (then (f64.sub (local.get $c) (local.get $term)))
            (else (f64.add (local.get $c) (local.get $term)))))
        (global.set $digits (i32.add (global.get $digits) (i32.const 1)))))
    (global.set $last (local.get $v)))

  (func $dot (export "dot")
    (if (global.get $err) (then (call $clear)))
    (if (global.get $startNew)
      (then
        (global.set $cur (f64.const 0))
        (global.set $scale (f64.const 1))
        (global.set $last (f64.const 0))
        (global.set $digits (i32.const 0))
        (global.set $frac (i32.const 1))
        (global.set $startNew (i32.const 0)))
      (else
        (if (i32.eqz (global.get $frac))
          (then
            (global.set $frac (i32.const 1))
            (global.set $digits (i32.const 0))
            (global.set $scale (f64.const 1)))))))

  (func $back (export "back")
    (local $t f64)
    (if (global.get $err) (then (call $clear) (return)))
    (if (global.get $startNew) (then (return)))
    (if (global.get $frac)
      (then
        (if (i32.eqz (global.get $digits))
          (then
            (global.set $frac (i32.const 0))
            (return)))
        (global.set $cur
          (f64.sub (global.get $cur)
            (f64.mul (global.get $last) (global.get $scale))))
        (global.set $scale (f64.mul (global.get $scale) (f64.const 10)))
        (global.set $digits
          (i32.sub (global.get $digits) (i32.const 1)))
        (if (global.get $digits)
          (then
            (local.set $t
              (f64.trunc
                (f64.add
                  (f64.abs (f64.div (global.get $cur) (global.get $scale)))
                  (f64.const 1e-9)))))
          (else
            (global.set $frac (i32.const 0))
            (global.set $scale (f64.const 1))
            (local.set $t
              (f64.trunc
                (f64.add (f64.abs (global.get $cur)) (f64.const 1e-9))))))
        (global.set $last
          (f64.sub (local.get $t)
            (f64.mul
              (f64.trunc (f64.div (local.get $t) (f64.const 10)))
              (f64.const 10))))
        (if (f64.lt (global.get $cur) (f64.const 0))
          (then (global.set $last (f64.neg (global.get $last))))))
      (else
        (global.set $cur
          (f64.trunc
            (f64.div
              (f64.sub (global.get $cur) (global.get $last))
              (f64.const 10))))
        (local.set $t
          (f64.trunc
            (f64.add (f64.abs (global.get $cur)) (f64.const 1e-9))))
        (global.set $last
          (f64.sub (local.get $t)
            (f64.mul
              (f64.trunc (f64.div (local.get $t) (f64.const 10)))
              (f64.const 10))))
        (if (f64.lt (global.get $cur) (f64.const 0))
          (then (global.set $last (f64.neg (global.get $last)))))
        (if (f64.eq (global.get $cur) (f64.const 0))
          (then (global.set $startNew (i32.const 1)))))))

  (func $neg (export "neg")
    (local $t f64)
    (if (global.get $err) (then (call $clear) (return)))
    (if (i32.and (global.get $startNew) (global.get $op))
      (then
        (global.set $acc (f64.neg (global.get $acc))))
      (else
        (global.set $cur (f64.neg (global.get $cur)))
        (local.set $t
          (f64.trunc
            (f64.add
              (f64.abs (f64.div (global.get $cur) (global.get $scale)))
              (f64.const 1e-9))))
        (global.set $last
          (f64.sub (local.get $t)
            (f64.mul
              (f64.trunc (f64.div (local.get $t) (f64.const 10)))
              (f64.const 10))))
        (if (f64.lt (global.get $cur) (f64.const 0))
          (then (global.set $last (f64.neg (global.get $last))))))))

  (func $op (export "op") (param $o i32)
    (local $a f64)
    (local $c f64)
    (if (global.get $err) (then (call $clear)))
    (if (global.get $op)
      (then
        (if (i32.eqz (global.get $startNew))
          (then
            (local.set $a (global.get $acc))
            (local.set $c (global.get $cur))
            (block $applyDone
              (block $case4
                (block $case3
                  (block $case2
                    (block $case1
                      (block $default
                        (br_table $case1 $case2 $case3 $case4 $default
                          (i32.sub (global.get $op) (i32.const 1))))
                      (local.set $a (local.get $c))
                      (br $applyDone))
                    (local.set $a (f64.add (local.get $a) (local.get $c)))
                    (br $applyDone))
                  (local.set $a (f64.sub (local.get $a) (local.get $c)))
                  (br $applyDone))
                (local.set $a (f64.mul (local.get $a) (local.get $c)))
                (br $applyDone))
              (if (f64.eq (local.get $c) (f64.const 0))
                (then
                  (global.set $err (i32.const 1))
                  (local.set $a (f64.const 0)))
                (else
                  (local.set $a (f64.div (local.get $a) (local.get $c))))))
            (global.set $acc (local.get $a))
            (global.set $cur (local.get $a)))))
      (else
        (global.set $acc (global.get $cur))))
    (global.set $lastOp (local.get $o))
    (global.set $op (local.get $o))
    (global.set $startNew (i32.const 1))
    (global.set $err (i32.const 0)))

  (func $equals (export "equals")
    (local $a f64)
    (local $c f64)
    (local $op i32)
    (if (global.get $err) (then (return)))
    (local.set $op (global.get $op))
    (if (local.get $op)
      (then
        (local.set $a (global.get $acc))
        (local.set $c (global.get $cur))
        (global.set $left (local.get $a))
        (global.set $operand (local.get $c))
        (block $applyDone
          (block $case4
            (block $case3
              (block $case2
                (block $case1
                  (block $default
                    (br_table $case1 $case2 $case3 $case4 $default
                      (i32.sub (local.get $op) (i32.const 1))))
                  (local.set $a (local.get $c))
                  (br $applyDone))
                (local.set $a (f64.add (local.get $a) (local.get $c)))
                (br $applyDone))
              (local.set $a (f64.sub (local.get $a) (local.get $c)))
              (br $applyDone))
            (local.set $a (f64.mul (local.get $a) (local.get $c)))
            (br $applyDone))
          (if (f64.eq (local.get $c) (f64.const 0))
            (then
              (global.set $err (i32.const 1))
              (local.set $a (f64.const 0)))
            (else
              (local.set $a (f64.div (local.get $a) (local.get $c))))))
        (global.set $acc (local.get $a))
        (global.set $cur (local.get $a))
        (global.set $lastOp (local.get $op))
        (global.set $op (i32.const 0))
        (global.set $startNew (i32.const 1)))
      (else
        (if (i32.and (global.get $lastOp) (global.get $startNew))
          (then
            (local.set $op (global.get $lastOp))
            (local.set $c (global.get $operand))
            (local.set $a (global.get $acc))
            (global.set $left (local.get $a))
            (global.set $cur (local.get $c))
            (block $applyDone2
              (block $case4_2
                (block $case3_2
                  (block $case2_2
                    (block $case1_2
                      (block $default_2
                        (br_table $case1_2 $case2_2 $case3_2 $case4_2 $default_2
                          (i32.sub (local.get $op) (i32.const 1))))
                      (local.set $a (local.get $c))
                      (br $applyDone2))
                    (local.set $a (f64.add (local.get $a) (local.get $c)))
                    (br $applyDone2))
                  (local.set $a (f64.sub (local.get $a) (local.get $c)))
                  (br $applyDone2))
                (local.set $a (f64.mul (local.get $a) (local.get $c)))
                (br $applyDone2))
              (if (f64.eq (local.get $c) (f64.const 0))
                (then
                  (global.set $err (i32.const 1))
                  (local.set $a (f64.const 0)))
                (else
                  (local.set $a (f64.div (local.get $a) (local.get $c))))))
            (global.set $acc (local.get $a))
            (global.set $cur (local.get $a))
            (global.set $op (i32.const 0))))
        (global.set $startNew (i32.const 1)))))

  (func $display (export "display") (result f64)
    (if (result f64)
      (i32.and (global.get $op) (global.get $startNew))
      (then (global.get $acc))
      (else (global.get $cur))))

  (func $acc (export "acc") (result f64) (global.get $acc))
  (func $cur (export "cur") (result f64) (global.get $cur))
  (func $opCode (export "opCode") (result i32) (global.get $op))
  (func $error (export "error") (result i32) (global.get $err))
  (func $fresh (export "fresh") (result i32) (global.get $startNew))
  (func $lastOp (export "lastOp") (result i32) (global.get $lastOp))
  (func $operand (export "operand") (result f64) (global.get $operand))
  (func $leftOperand (export "leftOperand") (result f64) (global.get $left)))
