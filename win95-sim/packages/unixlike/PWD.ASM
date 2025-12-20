; PWD.ASM - Print working directory (Unix pwd for CP/M)
; Shows current drive letter
;
        ORG     100H

BDOS    EQU     5
CONOUT  EQU     2           ; Console output
PRINT   EQU     9           ; Print string
GETDRV  EQU     25          ; Get current drive

START:  ; Get current drive (returns 0=A, 1=B, etc)
        MVI     C,GETDRV
        CALL    BDOS

        ; Convert to letter (add 'A')
        ADI     'A'
        MOV     E,A
        MVI     C,CONOUT
        CALL    BDOS

        ; Print ":/"
        LXI     D,SUFFIX
        MVI     C,PRINT
        CALL    BDOS

        RET

SUFFIX: DB      ':/',13,10,'$'

        END     START
