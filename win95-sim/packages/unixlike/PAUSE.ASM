; PAUSE.ASM - Wait for keypress
; Displays message and waits for any key
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9
CONIN   EQU     1           ; Console input

START:  LXI     D,MSG
        MVI     C,PRINT
        CALL    BDOS

        ; Wait for keypress
        MVI     C,CONIN
        CALL    BDOS

        ; Print newline
        MVI     E,13
        MVI     C,2
        CALL    BDOS
        MVI     E,10
        MVI     C,2
        CALL    BDOS

        RET

MSG:    DB      'Press any key to continue...$'

        END     START
