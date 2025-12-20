; EXIT.ASM - Exit to system (Unix exit for CP/M)
; Performs a warm boot
;
        ORG     100H

BDOS    EQU     5
WBOOT   EQU     0           ; Warm boot function

START:  MVI     C,WBOOT
        JMP     BDOS        ; Warm boot (doesn't return)

        END     START
