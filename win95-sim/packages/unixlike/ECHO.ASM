; ECHO.ASM - Print arguments to console (Unix echo for CP/M)
; Command tail is at 80h: first byte = length, rest = text
;
        ORG     100H

BDOS    EQU     5
CONOUT  EQU     2           ; Console output

CMDTAIL EQU     80H         ; Command tail buffer

START:  ; Get command tail length
        LDA     CMDTAIL
        ORA     A
        JZ      NEWLN       ; No args, just print newline

        ; Print the command tail
        MOV     B,A         ; B = length
        LXI     H,CMDTAIL+1 ; HL = start of text

PLOOP:  MOV     A,M
        MOV     E,A
        PUSH    H
        PUSH    B
        MVI     C,CONOUT
        CALL    BDOS
        POP     B
        POP     H
        INX     H
        DCR     B
        JNZ     PLOOP

        ; Print newline
NEWLN:  MVI     E,13
        MVI     C,CONOUT
        CALL    BDOS
        MVI     E,10
        MVI     C,CONOUT
        CALL    BDOS

        RET

        END     START
