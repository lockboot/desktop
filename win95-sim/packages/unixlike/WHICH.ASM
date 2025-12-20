; WHICH.ASM - Find command location (Unix which for CP/M)
; Searches current drive then A: for .COM file
;
        ORG     100H

BDOS    EQU     5
CONOUT  EQU     2
PRINT   EQU     9
SFIRST  EQU     17          ; Search for first
GETDRV  EQU     25          ; Get current drive
SETDMA  EQU     26

FCB     EQU     5CH         ; Default FCB
DMA     EQU     80H

START:  ; Check if command name provided
        LDA     FCB+1
        CPI     ' '
        JZ      USAGE

        ; Force .COM extension
        LXI     H,COMEXT
        LXI     D,FCB+9
        MVI     B,3
SETEXT: MOV     A,M
        STAX    D
        INX     H
        INX     D
        DCR     B
        JNZ     SETEXT

        ; Set DMA
        LXI     D,DMA
        MVI     C,SETDMA
        CALL    BDOS

        ; Save original drive
        LDA     FCB
        STA     ORGDRV

        ; If no drive specified, try current drive first
        ORA     A
        JNZ     SEARCH      ; Drive was specified

        ; Get current drive and try it
        MVI     C,GETDRV
        CALL    BDOS
        INR     A           ; Convert to 1-based
        STA     FCB
        CALL    TRYFIND
        JNC     FOUND

        ; Try A: drive
        MVI     A,1         ; A: = 1
        STA     FCB
        CALL    TRYFIND
        JNC     FOUND

        JMP     NOTFND

SEARCH: ; Specific drive requested
        CALL    TRYFIND
        JNC     FOUND

NOTFND: LXI     D,NFMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

FOUND:  ; Print drive letter
        LDA     FCB
        DCR     A           ; Convert to 0-based
        ADI     'A'
        MOV     E,A
        MVI     C,CONOUT
        CALL    BDOS

        ; Print ":"
        MVI     E,':'
        MVI     C,CONOUT
        CALL    BDOS

        ; Print filename
        LXI     H,FCB+1
        MVI     B,8
PRNAME: MOV     A,M
        CPI     ' '
        JZ      PRDOT
        MOV     E,A
        PUSH    H
        PUSH    B
        MVI     C,CONOUT
        CALL    BDOS
        POP     B
        POP     H
PRDOT:  INX     H
        DCR     B
        JNZ     PRNAME

        ; Print ".COM"
        LXI     D,DOTCOM
        MVI     C,PRINT
        CALL    BDOS

        RET

; Try to find file, returns carry clear if found
TRYFIND:
        LXI     D,FCB
        MVI     C,SFIRST
        CALL    BDOS
        CPI     0FFH
        JZ      TFNF
        ORA     A           ; Clear carry = found
        RET
TFNF:   STC                 ; Set carry = not found
        RET

USAGE:  LXI     D,USMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

ORGDRV: DB      0
COMEXT: DB      'COM'
DOTCOM: DB      '.COM',13,10,'$'
NFMSG:  DB      'Not found',13,10,'$'
USMSG:  DB      'Usage: WHICH command',13,10,'$'

        END     START
