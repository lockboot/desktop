; XMAS.ASM - Sine Wave Christmas Tree
; Auto-detects CGI mode by checking for CGI.ENV
; Assemble with: ASM XMAS
; Then: LOAD XMAS
;
; (c) 2024 - A festive greeting from the past

        ORG     100H

BDOS    EQU     5
CONOUT  EQU     2
PRINT   EQU     9
OPEN    EQU     15

START:
        ; Try to open CGI.ENV to detect CGI mode
        LXI     D,CGIFCB
        MVI     C,OPEN
        CALL    BDOS
        CPI     0FFH            ; File not found = terminal mode
        JZ      TERM

; ==================== CGI MODE ====================
CGI:
        LXI     D,CGIHDR        ; Output Content-Type header first
        MVI     C,PRINT
        CALL    BDOS

        LXI     D,HTMLHD
        MVI     C,PRINT
        CALL    BDOS

        CALL    DRAWALL

        LXI     D,HTMLFT
        MVI     C,PRINT
        CALL    BDOS
        JMP     EXIT

; ==================== TERMINAL MODE ====================
TERM:
        LXI     D,CRLF
        MVI     C,PRINT
        CALL    BDOS

        CALL    DRAWALL

        JMP     EXIT

; ==================== DRAW EVERYTHING ====================
DRAWALL:
        CALL    DRAWSTAR
        CALL    DRAWTREE
        CALL    DRAWTRUNK
        CALL    DRAWMSG
        RET

; ==================== STAR ====================
DRAWSTAR:
        MVI     B,17
        CALL    SPACES
        MVI     E,'*'
        MVI     C,CONOUT
        CALL    BDOS
        LXI     D,CRLF
        MVI     C,PRINT
        CALL    BDOS
        RET

; ==================== TREE BODY ====================
DRAWTREE:
        MVI     A,0
        STA     ROW

TLOOP:
        LDA     ROW
        CPI     15              ; 15 rows of tree
        RZ

        ; Get sine wobble for this row (0-3 range)
        LDA     ROW
        ANI     07H             ; Mask to 0-7
        LXI     H,SINTAB
        ADD     L
        MOV     L,A
        MOV     A,M             ; A = sine wobble (0-3)
        STA     WOBBLE

        ; Calculate leading spaces: 16 - row + wobble
        LDA     ROW
        MOV     B,A             ; B = row
        MVI     A,16
        SUB     B               ; A = 16 - row (base indent)
        MOV     B,A             ; B = base indent
        LDA     WOBBLE
        ADD     B               ; A = indent + wobble
        MOV     B,A
        CALL    SPACES

        ; Width = (row + 1) * 2 + 1 - wobble*2
        LDA     ROW
        INR     A               ; row + 1
        ADD     A               ; * 2
        INR     A               ; + 1 center
        MOV     B,A             ; B = base width
        LDA     WOBBLE
        ADD     A               ; wobble * 2
        MOV     C,A
        MOV     A,B
        SUB     C               ; width - wobble*2
        MOV     B,A
        CALL    STARS

        LXI     D,CRLF
        MVI     C,PRINT
        CALL    BDOS

        LDA     ROW
        INR     A
        STA     ROW
        JMP     TLOOP

; ==================== TRUNK ====================
DRAWTRUNK:
        MVI     A,3             ; 3 trunk rows
        STA     TCNT
TRLP:
        MVI     B,15
        CALL    SPACES
        LXI     D,TRNK
        MVI     C,PRINT
        CALL    BDOS
        LDA     TCNT
        DCR     A
        STA     TCNT
        JNZ     TRLP
        RET

; ==================== MESSAGE ====================
DRAWMSG:
        LXI     D,CRLF
        MVI     C,PRINT
        CALL    BDOS
        MVI     B,7
        CALL    SPACES
        LXI     D,MSG
        MVI     C,PRINT
        CALL    BDOS
        RET

; ==================== UTILITIES ====================

; Print B spaces
SPACES:
        MOV     A,B
        ORA     A
        RZ
SPLP:   PUSH    B
        MVI     E,' '
        MVI     C,CONOUT
        CALL    BDOS
        POP     B
        DCR     B
        JNZ     SPLP
        RET

; Print B stars
STARS:
        MOV     A,B
        ORA     A
        RZ
        CPI     80              ; Sanity check
        RNC
STLP:   PUSH    B
        MVI     E,'*'
        MVI     C,CONOUT
        CALL    BDOS
        POP     B
        DCR     B
        JNZ     STLP
        RET

; ==================== DATA ====================

ROW:    DB      0
WOBBLE: DB      0
TCNT:   DB      0

; Sine table - gentle wobble (0 to 3, positive only for simplicity)
SINTAB: DB      1,2,3,3,2,1,0,0

; FCB for CGI.ENV detection
CGIFCB: DB      0,'CGI     ','ENV',0,0,0,0
        DS      20              ; Rest of FCB

TRNK:   DB      '|||',13,10,'$'
CRLF:   DB      13,10,'$'
MSG:    DB      'MERRY CHRISTMAS!',13,10,'$'

; CGI header and HTML wrappers
CGIHDR: DB      'Content-Type: text/html',13,10,13,10,'$'
HTMLHD: DB      '<pre style="font-family:monospace;color:#0f0;'
        DB      'background:#000;padding:20px">',13,10,'$'
HTMLFT: DB      '</pre>$'

EXIT:
        JMP     0               ; Warm boot

        END
