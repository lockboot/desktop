; CAT.ASM - Display file contents (Unix cat for CP/M)
; Uses BDOS to open and read file sequentially
;
        ORG     100H

BDOS    EQU     5
CONOUT  EQU     2           ; Console output
PRINT   EQU     9
OPEN    EQU     15          ; Open file
READ    EQU     20          ; Read sequential
SETDMA  EQU     26          ; Set DMA address

FCB     EQU     5CH         ; Default FCB
DMA     EQU     80H         ; Default DMA buffer

START:  ; Check if filename provided
        LDA     FCB+1
        CPI     ' '
        JZ      USAGE

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

        JMP     RLOOP

DONE:   RET

NOFILE: LXI     D,NFMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

USAGE:  LXI     D,USMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

NFMSG:  DB      'File not found',13,10,'$'
USMSG:  DB      'Usage: CAT filename',13,10,'$'

        END     START
