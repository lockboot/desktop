; MV.ASM - Move/rename file (Unix mv for CP/M)
; Uses BDOS Rename function
; Usage: MV oldname newname
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9
RENAME  EQU     23          ; Rename file

FCB1    EQU     5CH         ; First FCB (old name)
FCB2    EQU     6CH         ; Second FCB (new name)

START:  ; Check if both filenames provided
        LDA     FCB1+1
        CPI     ' '
        JZ      USAGE
        LDA     FCB2+1
        CPI     ' '
        JZ      USAGE

        ; Copy new name to FCB1+16 (where BDOS expects it)
        ; Format: drive(1) + name(8) + ext(3) = 12 bytes
        LXI     H,FCB2      ; Source: including drive byte
        LXI     D,FCB1+16   ; Dest: second half of FCB1
        MVI     B,12        ; drive + 8 + 3 chars
COPY:   MOV     A,M
        STAX    D
        INX     H
        INX     D
        DCR     B
        JNZ     COPY

        ; Do the rename
        LXI     D,FCB1
        MVI     C,RENAME
        CALL    BDOS

        CPI     0FFH
        JZ      ERROR

        RET

ERROR:  LXI     D,ERRMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

USAGE:  LXI     D,USMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

ERRMSG: DB      'Error: file not found or name exists',13,10,'$'
USMSG:  DB      'Usage: MV oldname newname',13,10,'$'

        END     START
