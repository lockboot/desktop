; HELP.ASM - Display help topics (Unix man-like for CP/M)
; No args: list available topics (*.DOC files)
; With arg: display <topic>.DOC with paging
;
        ORG     100H

BDOS    EQU     5
CONIN   EQU     1           ; Console input
CONOUT  EQU     2           ; Console output
PRINT   EQU     9
OPEN    EQU     15          ; Open file
READ    EQU     20          ; Read sequential
SFIRST  EQU     17          ; Search for first
SNEXT   EQU     18          ; Search for next
SETDMA  EQU     26          ; Set DMA address

FCB     EQU     5CH         ; Default FCB
DMA     EQU     80H         ; Default DMA buffer
LINES   EQU     23          ; Lines per page

START:  ; Check if topic provided
        LDA     FCB+1
        CPI     ' '
        JZ      LIST        ; No arg - list topics

        ; Topic provided - set extension to .DOC
        MVI     A,'D'
        STA     FCB+9
        MVI     A,'O'
        STA     FCB+10
        MVI     A,'C'
        STA     FCB+11

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
        PUSH    PSW         ; Save A (the LF character)
        CALL    NEWLN
        POP     PSW         ; Restore A
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

; Quit - clean up stack and exit
QUIT:   POP     PSW         ; Clean up from NEWLN
        POP     B
        POP     H
        ; Print newline before exit
        MVI     E,13
        MVI     C,CONOUT
        CALL    BDOS
        MVI     E,10
        MVI     C,CONOUT
        CALL    BDOS
        RET

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

        ; Check for 'q' or 'Q' to quit
        CPI     'q'
        JZ      QUIT
        CPI     'Q'
        JZ      QUIT

        ; Clear prompt line
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

; List available topics (*.DOC files)
LIST:   LXI     D,LISTMSG
        MVI     C,PRINT
        CALL    BDOS

        ; Set FCB to *.DOC
        LXI     H,FCB+1
        MVI     M,'?'
        INX     H
        MVI     M,'?'
        INX     H
        MVI     M,'?'
        INX     H
        MVI     M,'?'
        INX     H
        MVI     M,'?'
        INX     H
        MVI     M,'?'
        INX     H
        MVI     M,'?'
        INX     H
        MVI     M,'?'
        INX     H
        MVI     M,'D'       ; Extension = DOC
        INX     H
        MVI     M,'O'
        INX     H
        MVI     M,'C'

        ; Set DMA for directory results
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
LSLOOP: CALL    PENTRY      ; Print this entry

        ; Search for next
        LXI     D,FCB
        MVI     C,SNEXT
        CALL    BDOS

        CPI     0FFH        ; No more files?
        JNZ     LSLOOP

        ; Print usage hint
        LXI     D,USAGE
        MVI     C,PRINT
        CALL    BDOS
        RET

NONE:   LXI     D,NOMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

; Print directory entry (just the filename, no extension)
; A = directory code (0-3), entry at DMA + A*32
PENTRY: ANI     3           ; Mask to 0-3
        RRC                 ; Multiply by 32
        RRC
        RRC
        MOV     L,A
        MVI     H,0
        LXI     D,DMA
        DAD     D           ; HL = DMA + offset

        ; Print "  " indent
        MVI     E,' '
        MVI     C,CONOUT
        CALL    BDOS
        MVI     E,' '
        MVI     C,CONOUT
        CALL    BDOS

        ; Skip user number (byte 0)
        INX     H

        ; Print 8-char filename (strip trailing spaces)
        MVI     B,8
PFN:    MOV     A,M
        ANI     7FH         ; Strip high bit
        CPI     ' '
        JZ      PSKIP
        MOV     E,A
        PUSH    H
        PUSH    B
        MVI     C,CONOUT
        CALL    BDOS
        POP     B
        POP     H
PSKIP:  INX     H
        DCR     B
        JNZ     PFN

        ; Print newline
        MVI     E,13
        MVI     C,CONOUT
        CALL    BDOS
        MVI     E,10
        MVI     C,CONOUT
        CALL    BDOS
        RET

NOFILE: LXI     D,NFMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

LCOUNT: DB      LINES       ; Line counter storage
PROMPT: DB      13,10,'--More-- (q to quit)$'
CLRLN:  DB      13,'                    ',13,'$'
NFMSG:  DB      'No help for that topic',13,10,'$'
NOMSG:  DB      'No help topics found',13,10,'$'
LISTMSG:DB      'Available topics:',13,10,'$'
USAGE:  DB      13,10,'Type HELP <topic> for details',13,10,'$'

        END     START
