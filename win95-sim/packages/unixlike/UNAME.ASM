; UNAME.ASM - Print system information (Unix uname for CP/M)
; Default: prints "CP/M"
; With any argument: prints full info like uname -a
;
        ORG     100H

BDOS    EQU     5
PRINT   EQU     9

CMDTAIL EQU     80H

START:  ; Check for arguments (any arg = verbose mode)
        LDA     CMDTAIL
        ORA     A
        JZ      SHORT

        ; Long format (like uname -a)
        LXI     D,LONGVER
        MVI     C,PRINT
        CALL    BDOS
        RET

SHORT:  ; Short format (like uname)
        LXI     D,SHORTVER
        MVI     C,PRINT
        CALL    BDOS
        RET

SHORTVER:
        DB      'CP/M',13,10,'$'
LONGVER:
        DB      'CP/M 2.2 8080 Digital-Research',13,10,'$'

        END     START
