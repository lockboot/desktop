; RM.ASM - Remove/delete file (Unix rm for CP/M)
; Uses BDOS Delete File function
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9
DELETE  EQU     19          ; Delete file

FCB     EQU     5CH         ; Default FCB

START:  ; Check if filename provided
        LDA     FCB+1
        CPI     ' '
        JZ      USAGE

        ; Delete file
        LXI     D,FCB
        MVI     C,DELETE
        CALL    BDOS

        CPI     0FFH
        JZ      NOFILE

        ; Success
        LXI     D,OKMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

NOFILE: LXI     D,NFMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

USAGE:  LXI     D,USMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

OKMSG:  DB      'Deleted',13,10,'$'
NFMSG:  DB      'File not found',13,10,'$'
USMSG:  DB      'Usage: RM filename',13,10,'$'

        END     START
