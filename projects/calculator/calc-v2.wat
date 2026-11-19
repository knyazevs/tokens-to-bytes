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
    (local $sign f64)
    (if (global.get $err) (then (call $clear)))
    (if (global.get $startNew)
      (then
        (global.set $cur (f64.const 0))
        (global.set $frac (i32.const 0))
        (global.set $scale (f64.const 1))
        (global.set $startNew (i32.const 0))))
    (local.set $v (f64.convert_i32_s (local.get $n)))
    (local.set $sign
      (select (f64.const -1) (f64.const 1)
        (f64.lt (global.get $cur) (f64.const 0))))
    (if (i32.eqz (global.get $frac))
      (then
        (global.set $cur
          (f64.add
            (f64.mul (global.get $cur) (f64.const 10))
            (f64.mul (local.get $v) (local.get $sign)))))
      (else
        (global.set $scale (f64.mul (global.get $scale) (f64.const 0.1)))
        (global.set $cur
          (f64.add (global.get $cur)
            (f64.mul
              (f64.mul (local.get $v) (global.get $scale))
              (local.get $sign))))
        (global.set $digits
          (i32.add (global.get $digits) (i32.const 1)))))
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
    (if (global.get $err) (then (call $clear)))
    (if (global.get $op)
      (then
        (if (i32.eqz (global.get $startNew))
          (then
            (block $applyDone
              (block $case4
                (block $case3
                  (block $case2
                    (block $case1
                      (block $default
                        (br_table $case1 $case2 $case3 $case4 $default
                          (i32.sub (global.get $op) (i32.const 1))))
                      (global.set $acc (global.get $cur))
                      (br $applyDone))
                    (global.set $acc
                      (f64.add (global.get $acc) (global.get $cur)))
                    (br $applyDone))
                  (global.set $acc
                    (f64.sub (global.get $acc) (global.get $cur)))
                  (br $applyDone))
                (global.set $acc
                  (f64.mul (global.get $acc) (global.get $cur)))
                (br $applyDone))
              (if (f64.eq (global.get $cur) (f64.const 0))
                (then
                  (global.set $err (i32.const 1))
                  (global.set $acc (f64.const 0)))
                (else
                  (global.set $acc
                    (f64.div (global.get $acc) (global.get $cur))))))
            (global.set $cur (global.get $acc)))))
      (else
        (global.set $acc (global.get $cur))))
    (global.set $lastOp (local.get $o))
    (global.set $op (local.get $o))
    (global.set $startNew (i32.const 1))
    (global.set $err (i32.const 0)))

  (func $equals (export "equals")
    (if (global.get $err) (then (return)))
    (if (i32.eqz (global.get $op))
      (then
        (if (i32.and (global.get $lastOp) (global.get $startNew))
          (then
            (global.set $op (global.get $lastOp))
            (global.set $cur (global.get $operand))))))
    (if (global.get $op)
      (then
        (global.set $left (global.get $acc))
        (global.set $operand (global.get $cur))
        (block $applyDone
          (block $case4
            (block $case3
              (block $case2
                (block $case1
                  (block $default
                    (br_table $case1 $case2 $case3 $case4 $default
                      (i32.sub (global.get $op) (i32.const 1))))
                  (global.set $acc (global.get $cur))
                  (br $applyDone))
                (global.set $acc
                  (f64.add (global.get $acc) (global.get $cur)))
                (br $applyDone))
              (global.set $acc
                (f64.sub (global.get $acc) (global.get $cur)))
              (br $applyDone))
            (global.set $acc
              (f64.mul (global.get $acc) (global.get $cur)))
            (br $applyDone))
          (if (f64.eq (global.get $cur) (f64.const 0))
            (then
              (global.set $err (i32.const 1))
              (global.set $acc (f64.const 0)))
            (else
              (global.set $acc
                (f64.div (global.get $acc) (global.get $cur))))))
        (global.set $cur (global.get $acc))
        (global.set $lastOp (global.get $op))
        (global.set $op (i32.const 0))
        (global.set $startNew (i32.const 1)))
      (else
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
