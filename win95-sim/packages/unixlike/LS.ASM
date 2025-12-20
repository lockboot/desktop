; LS.ASM - List files (Unix ls for CP/M)
; Uses BDOS Search First/Next to list directory
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9
SFIRST  EQU     17          ; Search for first
SNEXT   EQU     18          ; Search for next
SETDMA  EQU     26          ; Set DMA address

FCB     EQU     5CH         ; Default FCB (filled by CCP)
DMA     EQU     80H         ; Default DMA buffer

START:  ; Check if FCB has a filename, if not use *.*
        LDA     FCB+1       ; First char of filename
        CPI     ' '         ; Space = no argument
        JNZ     SEARCH      ; Has filename, use it

        ; Set FCB to *.* (all files)
        LXI     H,FCB+1
        MVI     B,11        ; 8+3 characters
SETSTAR:MVI     M,'?'       ; ? matches anything
        INX     H
        DCR     B
        JNZ     SETSTAR

SEARCH: ; Set DMA for directory results
        LXI     D,DMA
        MVI     C,SETDMA
        CALL    BDOS

        ; Search for first match
        LXI     D,FCB
        MVI     C,SFIRST
        CALL    BDOS

        CPI     0FFH        ; No files found?
        JZ      NONE

        ; Print matches
PLOOP:  CALL    PENTRY      ; Print this entry

        ; Search for next
        LXI     D,FCB
        MVI     C,SNEXT
        CALL    BDOS

        CPI     0FFH        ; No more files?
        JNZ     PLOOP

        ; Done
        RET

NONE:   LXI     D,NOMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

; Print directory entry
; A = directory code (0-3), entry at DMA + A*32
PENTRY: ANI     3           ; Mask to 0-3
        RRC                 ; Multiply by 32
        RRC
        RRC
        MOV     L,A
        MVI     H,0
        LXI     D,DMA
        DAD     D           ; HL = DMA + offset

        ; Skip user number (byte 0)
        INX     H

        ; Print 8-char filename
        MVI     B,8
PFN:    MOV     A,M
        ANI     7FH         ; Strip high bit
        CPI     ' '
        JZ      PSKIP1
        MOV     E,A
        PUSH    H
        PUSH    B
        MVI     C,2
        CALL    BDOS
        POP     B
        POP     H
PSKIP1: INX     H
        DCR     B
        JNZ     PFN

        ; Print dot
        MVI     E,'.'
        MVI     C,2
        CALL    BDOS

        ; Print 3-char extension
        MVI     B,3
PEX:    MOV     A,M
        ANI     7FH
        CPI     ' '
        JZ      PSKIP2
        MOV     E,A
        PUSH    H
        PUSH    B
        MVI     C,2
        CALL    BDOS
        POP     B
        POP     H
PSKIP2: INX     H
        DCR     B
        JNZ     PEX

        ; Print newline after each entry
        MVI     E,13
        MVI     C,2
        CALL    BDOS
        MVI     E,10
        MVI     C,2
        CALL    BDOS
        RET

NOMSG:  DB      'No files found',13,10,'$'

        END     START
