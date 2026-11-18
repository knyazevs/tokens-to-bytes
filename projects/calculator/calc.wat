(module
 (type $0 (func))
 (type $1 (func (result f64)))
 (type $2 (func (result i32)))
 (type $3 (func (param i32)))
 (global $global$0 (mut f64) (f64.const 0))
 (global $global$1 (mut f64) (f64.const 0))
 (global $global$2 (mut f64) (f64.const 1))
 (global $global$3 (mut f64) (f64.const 0))
 (global $global$4 (mut i32) (i32.const 0))
 (global $global$5 (mut i32) (i32.const 0))
 (global $global$6 (mut i32) (i32.const 1))
 (global $global$7 (mut i32) (i32.const 0))
 (global $global$8 (mut i32) (i32.const 0))
 (global $global$9 (mut i32) (i32.const 0))
 (global $global$10 (mut f64) (f64.const 0))
 (global $global$11 (mut f64) (f64.const 0))
 (export "clear" (func $1))
 (export "ce" (func $2))
 (export "digit" (func $4))
 (export "dot" (func $5))
 (export "back" (func $6))
 (export "neg" (func $7))
 (export "op" (func $9))
 (export "equals" (func $10))
 (export "display" (func $11))
 (export "acc" (func $12))
 (export "cur" (func $13))
 (export "opCode" (func $14))
 (export "error" (func $15))
 (export "fresh" (func $16))
 (export "lastOp" (func $17))
 (export "operand" (func $18))
 (export "leftOperand" (func $19))
 (func $0
  (global.set $global$1
   (f64.const 0)
  )
  (global.set $global$2
   (f64.const 1)
  )
  (global.set $global$3
   (f64.const 0)
  )
  (global.set $global$6
   (i32.const 1)
  )
  (global.set $global$7
   (i32.const 0)
  )
  (global.set $global$8
   (i32.const 0)
  )
 )
 (func $1
  (call $0)
  (global.set $global$0
   (f64.const 0)
  )
  (global.set $global$4
   (i32.const 0)
  )
  (global.set $global$5
   (i32.const 0)
  )
  (global.set $global$9
   (i32.const 0)
  )
  (global.set $global$10
   (f64.const 0)
  )
  (global.set $global$11
   (f64.const 0)
  )
 )
 (func $2
  (call $0)
  (global.set $global$9
   (i32.const 0)
  )
 )
 (func $3
  (local $0 f64)
  (local $1 f64)
  (local.set $0
   (f64.trunc
    (f64.add
     (f64.abs
      (f64.div
       (global.get $global$1)
       (global.get $global$2)
      )
     )
     (f64.const 1e-09)
    )
   )
  )
  (local.set $1
   (f64.sub
    (local.get $0)
    (f64.mul
     (f64.trunc
      (f64.div
       (local.get $0)
       (f64.const 10)
      )
     )
     (f64.const 10)
    )
   )
  )
  (if
   (f64.lt
    (global.get $global$1)
    (f64.const 0)
   )
   (then
    (local.set $1
     (f64.neg
      (local.get $1)
     )
    )
   )
  )
  (global.set $global$3
   (local.get $1)
  )
 )
 (func $4 (param $0 i32)
  (local $1 f64)
  (local $2 f64)
  (if
   (global.get $global$9)
   (then
    (call $1)
   )
  )
  (if
   (global.get $global$6)
   (then
    (call $0)
    (global.set $global$6
     (i32.const 0)
    )
   )
  )
  (local.set $1
   (f64.convert_i32_s
    (local.get $0)
   )
  )
  (local.set $2
   (select
    (f64.const -1)
    (f64.const 1)
    (f64.lt
     (global.get $global$1)
     (f64.const 0)
    )
   )
  )
  (if
   (global.get $global$7)
   (then
    (global.set $global$2
     (f64.div
      (global.get $global$2)
      (f64.const 10)
     )
    )
    (global.set $global$1
     (f64.add
      (global.get $global$1)
      (f64.mul
       (f64.mul
        (local.get $1)
        (global.get $global$2)
       )
       (local.get $2)
      )
     )
    )
    (global.set $global$8
     (i32.add
      (global.get $global$8)
      (i32.const 1)
     )
    )
   )
   (else
    (global.set $global$1
     (f64.add
      (f64.mul
       (global.get $global$1)
       (f64.const 10)
      )
      (f64.mul
       (local.get $1)
       (local.get $2)
      )
     )
    )
    (global.set $global$2
     (f64.const 1)
    )
   )
  )
  (global.set $global$3
   (local.get $1)
  )
 )
 (func $5
  (if
   (global.get $global$9)
   (then
    (call $1)
   )
  )
  (if
   (global.get $global$6)
   (then
    (call $0)
    (global.set $global$6
     (i32.const 0)
    )
   )
  )
  (if
   (i32.eqz
    (global.get $global$7)
   )
   (then
    (global.set $global$7
     (i32.const 1)
    )
   )
  )
 )
 (func $6
  (if
   (global.get $global$9)
   (then
    (call $1)
    (return)
   )
  )
  (if
   (global.get $global$6)
   (then
    (return)
   )
  )
  (if
   (global.get $global$7)
   (then
    (if
     (i32.eqz
      (global.get $global$8)
     )
     (then
      (global.set $global$7
       (i32.const 0)
      )
      (return)
     )
    )
   )
  )
  (if
   (global.get $global$7)
   (then
    (global.set $global$1
     (f64.sub
      (global.get $global$1)
      (f64.mul
       (global.get $global$3)
       (global.get $global$2)
      )
     )
    )
    (global.set $global$2
     (f64.mul
      (global.get $global$2)
      (f64.const 10)
     )
    )
    (global.set $global$8
     (i32.sub
      (global.get $global$8)
      (i32.const 1)
     )
    )
    (if
     (global.get $global$8)
     (then
      (call $3)
     )
     (else
      (global.set $global$7
       (i32.const 0)
      )
      (global.set $global$2
       (f64.const 1)
      )
      (call $3)
     )
    )
   )
   (else
    (global.set $global$1
     (f64.trunc
      (f64.div
       (f64.sub
        (global.get $global$1)
        (global.get $global$3)
       )
       (f64.const 10)
      )
     )
    )
    (call $3)
    (if
     (f64.eq
      (global.get $global$1)
      (f64.const 0)
     )
     (then
      (global.set $global$6
       (i32.const 1)
      )
     )
    )
   )
  )
 )
 (func $7
  (if
   (global.get $global$9)
   (then
    (call $1)
    (return)
   )
  )
  (if
   (i32.and
    (global.get $global$6)
    (global.get $global$4)
   )
   (then
    (global.set $global$0
     (f64.neg
      (global.get $global$0)
     )
    )
   )
   (else
    (global.set $global$1
     (f64.neg
      (global.get $global$1)
     )
    )
    (call $3)
   )
  )
 )
 (func $8
  (if
   (i32.eq
    (global.get $global$4)
    (i32.const 1)
   )
   (then
    (global.set $global$0
     (f64.add
      (global.get $global$0)
      (global.get $global$1)
     )
    )
   )
   (else
    (if
     (i32.eq
      (global.get $global$4)
      (i32.const 2)
     )
     (then
      (global.set $global$0
       (f64.sub
        (global.get $global$0)
        (global.get $global$1)
       )
      )
     )
     (else
      (if
       (i32.eq
        (global.get $global$4)
        (i32.const 3)
       )
       (then
        (global.set $global$0
         (f64.mul
          (global.get $global$0)
          (global.get $global$1)
         )
        )
       )
       (else
        (if
         (i32.eq
          (global.get $global$4)
          (i32.const 4)
         )
         (then
          (if
           (f64.eq
            (global.get $global$1)
            (f64.const 0)
           )
           (then
            (global.set $global$9
             (i32.const 1)
            )
            (global.set $global$0
             (f64.const 0)
            )
           )
           (else
            (global.set $global$0
             (f64.div
              (global.get $global$0)
              (global.get $global$1)
             )
            )
           )
          )
         )
         (else
          (global.set $global$0
           (global.get $global$1)
          )
         )
        )
       )
      )
     )
    )
   )
  )
 )
 (func $9 (param $0 i32)
  (if
   (global.get $global$9)
   (then
    (call $1)
   )
  )
  (if
   (global.get $global$4)
   (then
    (if
     (i32.eqz
      (global.get $global$6)
     )
     (then
      (call $8)
      (global.set $global$1
       (global.get $global$0)
      )
     )
    )
   )
   (else
    (global.set $global$0
     (global.get $global$1)
    )
   )
  )
  (global.set $global$5
   (local.get $0)
  )
  (global.set $global$4
   (local.get $0)
  )
  (global.set $global$6
   (i32.const 1)
  )
  (global.set $global$7
   (i32.const 0)
  )
  (global.set $global$8
   (i32.const 0)
  )
  (global.set $global$2
   (f64.const 1)
  )
  (global.set $global$3
   (f64.const 0)
  )
  (global.set $global$9
   (i32.const 0)
  )
 )
 (func $10
  (if
   (global.get $global$9)
   (then
    (return)
   )
  )
  (if
   (i32.eqz
    (global.get $global$4)
   )
   (then
    (if
     (i32.and
      (global.get $global$5)
      (global.get $global$6)
     )
     (then
      (global.set $global$4
       (global.get $global$5)
      )
      (global.set $global$1
       (global.get $global$10)
      )
     )
    )
   )
  )
  (if
   (global.get $global$4)
   (then
    (global.set $global$11
     (global.get $global$0)
    )
    (global.set $global$10
     (global.get $global$1)
    )
    (call $8)
    (global.set $global$1
     (global.get $global$0)
    )
    (global.set $global$5
     (global.get $global$4)
    )
    (global.set $global$4
     (i32.const 0)
    )
    (global.set $global$6
     (i32.const 1)
    )
    (global.set $global$7
     (i32.const 0)
    )
    (global.set $global$8
     (i32.const 0)
    )
    (global.set $global$2
     (f64.const 1)
    )
    (global.set $global$3
     (f64.const 0)
    )
   )
   (else
    (global.set $global$6
     (i32.const 1)
    )
   )
  )
 )
 (func $11 (result f64)
  (if (result f64)
   (i32.and
    (global.get $global$4)
    (global.get $global$6)
   )
   (then
    (global.get $global$0)
   )
   (else
    (global.get $global$1)
   )
  )
 )
 (func $12 (result f64)
  (global.get $global$0)
 )
 (func $13 (result f64)
  (global.get $global$1)
 )
 (func $14 (result i32)
  (global.get $global$4)
 )
 (func $15 (result i32)
  (global.get $global$9)
 )
 (func $16 (result i32)
  (global.get $global$6)
 )
 (func $17 (result i32)
  (global.get $global$5)
 )
 (func $18 (result f64)
  (global.get $global$10)
 )
 (func $19 (result f64)
  (global.get $global$11)
 )
)
