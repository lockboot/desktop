; TOUCH.ASM - Create empty file (Unix touch for CP/M)
; Creates file if it doesn't exist, leaves it alone if it does
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9
OPEN    EQU     15          ; Open file
CLOSE   EQU     16          ; Close file
CREATE  EQU     22          ; Create file

FCB     EQU     5CH         ; Default FCB

START:  ; Check if filename provided
        LDA     FCB+1
        CPI     ' '
        JZ      USAGE

        ; Clear FCB extent and record fields
        XRA     A
        STA     FCB+12      ; Extent
        STA     FCB+32      ; Current record

        ; Try to open file first
        LXI     D,FCB
        MVI     C,OPEN
        CALL    BDOS
        CPI     0FFH
        JZ      DOCREATE    ; File doesn't exist, create it

        ; File exists - just close it
        LXI     D,FCB
        MVI     C,CLOSE
        CALL    BDOS
        JMP     DONE

DOCREATE:
        ; Create new file
        LXI     D,FCB
        MVI     C,CREATE
        CALL    BDOS
        CPI     0FFH
        JZ      ERROR

        ; Close the created file
        LXI     D,FCB
        MVI     C,CLOSE
        CALL    BDOS

DONE:   RET

ERROR:  LXI     D,ERRMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

USAGE:  LXI     D,USMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

ERRMSG: DB      'Error creating file',13,10,'$'
USMSG:  DB      'Usage: TOUCH filename',13,10,'$'

        END     START
