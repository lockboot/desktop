; UNAME.ASM - Print system information (Unix uname for CP/M)
; Default: prints "CP/M"
; With any argument: prints full info like uname -a
;
; CPU detection: examines flags register behavior
; - 8080: bit 1 of flags is always 1
; - Z80:  bit 1 is N flag (0 after XOR)
; - 8085: like 8080, but bit 5 is V flag (set differently)
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9

CMDTAIL EQU     80H

START:  ; Detect CPU type first
        CALL    DETECT

        ; Check for arguments (any arg = verbose mode)
        LDA     CMDTAIL
        ORA     A
        JZ      SHORT

        ; Long format (like uname -a)
        LXI     D,LONGPFX
        MVI     C,PRINT
        CALL    BDOS

        ; Print detected CPU
        CALL    PRTCPU

        LXI     D,LONGSUF
        MVI     C,PRINT
        CALL    BDOS
        RET

SHORT:  ; Short format (like uname)
        LXI     D,SHORTVER
        MVI     C,PRINT
        CALL    BDOS
        RET

; Detect CPU type, store result in CPUTYPE
; 0 = 8080, 1 = 8085, 2 = Z80
DETECT: XOR     A           ; A=0, sets flags
        PUSH    PSW         ; Push A and flags
        POP     B           ; B=A(0), C=flags

        ; Check bit 1: always 1 on 8080/8085, 0 on Z80
        MOV     A,C
        ANI     02H         ; Isolate bit 1
        JZ      ISZ80       ; If 0, it's Z80

        ; It's 8080 or 8085. Check bit 5 behavior.
        ; On 8085, bit 5 is V flag. After XOR A, V=0.
        ; Do an operation that sets V on 8085: ADI 80H + ADI 80H overflows
        MVI     A,80H
        ADI     80H         ; Overflow: 0x80+0x80=0x100, sets V on 8085
        PUSH    PSW
        POP     B
        MOV     A,C
        ANI     20H         ; Check bit 5 (V on 8085)
        JNZ     IS8085      ; If set, it's 8085 with V flag

        ; It's 8080
        XRA     A
        STA     CPUTYPE
        RET

IS8085: MVI     A,1
        STA     CPUTYPE
        RET

ISZ80:  MVI     A,2
        STA     CPUTYPE
        RET

; Print CPU name based on CPUTYPE
PRTCPU: LDA     CPUTYPE
        ORA     A
        JZ      PRT8080
        CPI     1
        JZ      PRT8085
        ; else Z80
        LXI     D,CPUZ80
        MVI     C,PRINT
        CALL    BDOS
        RET
PRT8080:LXI     D,CPU8080
        MVI     C,PRINT
        CALL    BDOS
        RET
PRT8085:LXI     D,CPU8085
        MVI     C,PRINT
        CALL    BDOS
        RET

CPUTYPE:DB      0           ; 0=8080, 1=8085, 2=Z80
SHORTVER:
        DB      'CP/M',13,10,'$'
LONGPFX:
        DB      'CP/M 2.2 $'
CPU8080:DB      '8080$'
CPU8085:DB      '8085$'
CPUZ80: DB      'Z80$'
LONGSUF:
        DB      ' Digital-Research',13,10,'$'

        END     START
