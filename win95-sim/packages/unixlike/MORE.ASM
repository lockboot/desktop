; MORE.ASM - Display file with paging (Unix more for CP/M)
; Pauses every 23 lines, press any key to continue
;
        ORG     100H

BDOS    EQU     5
CONIN   EQU     1           ; Console input
CONOUT  EQU     2           ; Console output
PRINT   EQU     9
OPEN    EQU     15          ; Open file
READ    EQU     20          ; Read sequential
SETDMA  EQU     26          ; Set DMA address

FCB     EQU     5CH         ; Default FCB
DMA     EQU     80H         ; Default DMA buffer
LINES   EQU     23          ; Lines per page

START:  ; Check if filename provided
        LDA     FCB+1
        CPI     ' '
        JZ      USAGE

        ; Initialize line counter
        MVI     A,LINES
        STA     LCOUNT

        ; Open file
        LXI     D,FCB
        MVI     C,OPEN
        CALL    BDOS
        CPI     0FFH
        JZ      NOFILE

        ; Set DMA buffer
        LXI     D,DMA
        MVI     C,SETDMA
        CALL    BDOS

        ; Read and print loop
RLOOP:  LXI     D,FCB
        MVI     C,READ
        CALL    BDOS
        ORA     A           ; Check for EOF
        JNZ     DONE        ; Non-zero = EOF or error

        ; Print 128 bytes from DMA
        LXI     H,DMA
        MVI     B,128
PLOOP:  MOV     A,M
        CPI     1AH         ; Ctrl-Z = EOF
        JZ      DONE

        ; Check for newline
        CPI     0AH         ; LF
        JNZ     NOTLF
        CALL    NEWLN
NOTLF:  MOV     E,A
        PUSH    H
        PUSH    B
        MVI     C,CONOUT
        CALL    BDOS
        POP     B
        POP     H
        INX     H
        DCR     B
        JNZ     PLOOP

        JMP     RLOOP

DONE:   RET

; Handle newline - decrement counter, pause if needed
NEWLN:  PUSH    H
        PUSH    B
        LDA     LCOUNT
        DCR     A
        STA     LCOUNT
        JNZ     NLRET

        ; Page full - show prompt and wait
        PUSH    PSW
        LXI     D,PROMPT
        MVI     C,PRINT
        CALL    BDOS

        MVI     C,CONIN     ; Wait for keypress
        CALL    BDOS

        ; Clear prompt line (CR + spaces + CR)
        MVI     E,13
        MVI     C,CONOUT
        CALL    BDOS
        LXI     D,CLRLN
        MVI     C,PRINT
        CALL    BDOS
        POP     PSW

        ; Reset counter
        MVI     A,LINES
        STA     LCOUNT

NLRET:  POP     B
        POP     H
        RET

NOFILE: LXI     D,NFMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

USAGE:  LXI     D,USMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

LCOUNT: DB      LINES       ; Line counter storage
PROMPT: DB      '--More--$'
CLRLN:  DB      13,'        ',13,'$'
NFMSG:  DB      'File not found',13,10,'$'
USMSG:  DB      'Usage: MORE filename',13,10,'$'

        END     START
