; CD.ASM - Change directory/drive (Unix cd for CP/M)
; Usage: CD B: or CD B
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9
SELDSK  EQU     14          ; Select disk

FCB     EQU     5CH         ; Default FCB (drive in first byte)

START:  ; Check if argument provided
        LDA     FCB         ; Drive number (1=A, 2=B, etc, 0=default)
        ORA     A
        JZ      USAGE       ; No drive specified

        ; Convert to 0-based (0=A, 1=B, etc)
        DCR     A

        ; Select the disk
        MOV     E,A
        MVI     C,SELDSK
        CALL    BDOS

        RET

USAGE:  LXI     D,USMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

USMSG:  DB      'Usage: CD drive:',13,10
        DB      '  CD A:',13,10
        DB      '  CD B:',13,10,'$'

        END     START
