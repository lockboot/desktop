; WHOAMI.ASM - Print current user (Unix whoami for CP/M)
; Just prints "operator" like Unix prints username
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9

START:  LXI     D,USER
        MVI     C,PRINT
        CALL    BDOS
        RET

USER:   DB      'operator',13,10,'$'

        END     START
