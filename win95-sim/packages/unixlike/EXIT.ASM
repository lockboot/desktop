; EXIT.ASM - Exit emulator (Unix exit for CP/M)
; Uses HALT to signal emulator to exit cleanly
;
        ORG     100H

START:  HLT                 ; Halt CPU - emulator exits

        END     START
