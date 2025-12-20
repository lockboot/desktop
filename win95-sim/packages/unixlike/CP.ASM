; CP.ASM - Copy file (Unix cp for CP/M)
; Usage: CP source dest
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9
OPEN    EQU     15          ; Open file
CLOSE   EQU     16          ; Close file
READ    EQU     20          ; Read sequential
WRITE   EQU     21          ; Write sequential
CREATE  EQU     22          ; Create file
SETDMA  EQU     26          ; Set DMA address

FCB1    EQU     5CH         ; Source FCB
FCB2    EQU     6CH         ; Dest FCB (only 16 bytes valid)
DMA     EQU     80H         ; DMA buffer

START:  ; Check if both filenames provided
        LDA     FCB1+1
        CPI     ' '
        JZ      USAGE
        LDA     FCB2+1
        CPI     ' '
        JZ      USAGE

        ; Copy FCB2 to private DSTFCB (need full 36-byte FCB for file ops)
        LXI     H,FCB2
        LXI     D,DSTFCB
        MVI     B,12        ; Copy drive + name + ext
CPFCB:  MOV     A,M
        STAX    D
        INX     H
        INX     D
        DCR     B
        JNZ     CPFCB
        ; Clear rest of FCB
        MVI     B,24        ; Remaining bytes
CLRFCB: XRA     A
        STAX    D
        INX     D
        DCR     B
        JNZ     CLRFCB

        ; Initialize source FCB
        XRA     A
        STA     FCB1+12     ; Extent
        STA     FCB1+32     ; Current record

        ; Open source file
        LXI     D,FCB1
        MVI     C,OPEN
        CALL    BDOS
        CPI     0FFH
        JZ      NOSRC

        ; Create destination file
        LXI     D,DSTFCB
        MVI     C,CREATE
        CALL    BDOS
        CPI     0FFH
        JZ      NODST

        ; Set DMA buffer
        LXI     D,DMA
        MVI     C,SETDMA
        CALL    BDOS

        ; Copy loop
CPLOOP: ; Read from source
        LXI     D,FCB1
        MVI     C,READ
        CALL    BDOS
        ORA     A
        JNZ     CPDONE      ; EOF or error

        ; Write to dest
        LXI     D,DSTFCB
        MVI     C,WRITE
        CALL    BDOS
        ORA     A
        JNZ     WRERR

        JMP     CPLOOP

CPDONE: ; Close both files
        LXI     D,FCB1
        MVI     C,CLOSE
        CALL    BDOS

        LXI     D,DSTFCB
        MVI     C,CLOSE
        CALL    BDOS

        RET

NOSRC:  LXI     D,SRCMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

NODST:  LXI     D,DSTMSG
        MVI     C,PRINT
        CALL    BDOS
        ; Close source
        LXI     D,FCB1
        MVI     C,CLOSE
        CALL    BDOS
        RET

WRERR:  LXI     D,WRMSG
        MVI     C,PRINT
        CALL    BDOS
        JMP     CPDONE

USAGE:  LXI     D,USMSG
        MVI     C,PRINT
        CALL    BDOS
        RET

; Private FCB for destination file (36 bytes)
DSTFCB: DS      36

SRCMSG: DB      'Source file not found',13,10,'$'
DSTMSG: DB      'Cannot create destination',13,10,'$'
WRMSG:  DB      'Write error (disk full?)',13,10,'$'
USMSG:  DB      'Usage: CP source dest',13,10,'$'

        END     START
