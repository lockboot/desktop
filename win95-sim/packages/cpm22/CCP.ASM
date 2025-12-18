;	CONSOLE COMMAND PROCESSOR (CCP), ver 2.2
;	Assembly language version for CP/M 2.2
;
;	Copyright (c) 1976, 1977, 1978, 1979, 1980
;	Digital Research
;	Box 579, Pacific Grove, California, 93950
;
;	Cleaned for ASM.COM compatibility from os2ccp.asm
;	Original source: http://www.cpm.z80.de/download/cpm2-plm.zip
;
;	To assemble: ASM CCP
;	To convert:  LOAD CCP
;
;	NOTE: In our virtual CP/M environment, the CCP is reloaded fresh
;	on every warm boot - it doesn't reside in emulated RAM. This means
;	we can give programs nearly the full 64KB address space instead of
;	the traditional ~54KB TPA.
;
;	CCP lives at DC00H, BDOS at FE00H, giving ~55KB TPA.
;
	ORG	0DC00H		;High memory, below BDOS
;
TRAN	EQU	100H		;TPA where programs load
TRANM	EQU	0DC00H		;Top of TPA = bottom of CCP
CCPLOC	EQU	0DC00H		;CCP location
BDOSL	EQU	0FE00H		;BDOS location (virtual)
;
;	********************************************************
;	*	Base of CCP contains the following code/data   *
;	*	ccp:	jmp ccpstart	(start with command)   *
;	*		jmp ccpclear    (start, clear command) *
;	*	ccp+6	127		(max command length)   *
;	*	ccp+7	comlen		(command length = 00)  *
;	*	ccp+8	' ... '		(16 blanks)	       *
;	********************************************************
;
	JMP	CCPSTA		;start ccp with possible initial command
	JMP	CCPCLR		;clear the command buffer
MAXLEN:	DB	127		;max buffer length
COMLEN:	DB	0		;command length (filled in by dos)
;	(command executed initially if comlen non zero)
COMBUF:
	DB	'        '	;8 character fill
	DB	'        '	;8 character fill
	DB	'COPYRIGHT (C) 1979, DIGITAL RESEARCH  '
	DS	128-38-16	;fill to 128 bytes total
;	total buffer length is 128 characters
COMADR:	DW	COMBUF		;address of next char to scan
STADDR:	DS	2		;starting address of current fillfcb request
;
DTEFCB	EQU	0004H		;disk/user in page zero
BDOS	EQU	0005H		;primary bdos entry point
BUFF	EQU	0080H		;default buffer
FCB	EQU	005CH		;default file control block
;
RCHARF	EQU	1		;read character function
PCHARF	EQU	2		;print character function
PBUFF	EQU	9		;print buffer function
RBUFF	EQU	10		;read buffer function
BREAKF	EQU	11		;break key function
LIFTF	EQU	12		;lift head function (no operation)
INITF	EQU	13		;initialize bdos function
SELF	EQU	14		;select disk function
OPENF	EQU	15		;open file function
CLOSEF	EQU	16		;close file function
SEARF	EQU	17		;search for file function
SEARNF	EQU	18		;search for next file function
DELF	EQU	19		;delete file function
DREADF	EQU	20		;disk read function
DWRITF	EQU	21		;disk write function
MAKEF	EQU	22		;file make function
RENF	EQU	23		;rename file function
LOGF	EQU	24		;return login vector
CSELF	EQU	25		;return currently selected drive number
DMAF	EQU	26		;set dma address
USERF	EQU	32		;set user number
;
;	special fcb flags
ROFILE	EQU	9		;read only file
SYSFIL	EQU	10		;system file flag
;
;	special characters
CR	EQU	13		;carriage return
LF	EQU	10		;line feed
LA	EQU	5FH		;left arrow (underscore)
EOFILE	EQU	1AH		;end of file
;
;	utility procedures
PRTCHR:
	MOV	E,A
	MVI	C,PCHARF
	JMP	BDOS
;
PRTBC:
	;print character, but save b,c registers
	PUSH	B
	CALL	PRTCHR
	POP	B
	RET
;
CRLF:
	MVI	A,CR
	CALL	PRTBC
	MVI	A,LF
	JMP	PRTBC
;
BLANK:
	MVI	A,' '
	JMP	PRTBC
;
PRINT:	;print string starting at b,c until next 00 entry
	PUSH	B		;now print the string
	CALL	CRLF
	POP	H
PRIN0:	MOV	A,M		;stop on 00
	ORA	A
	RZ
	INX	H		;ready for next
	PUSH	H
	CALL	PRTCHR		;character printed
	POP	H
	JMP	PRIN0		;for another character
;
INITLZ:
	MVI	C,INITF
	JMP	BDOS
;
SELECT:
	MOV	E,A
	MVI	C,SELF
	JMP	BDOS
;
BDSINR:
	CALL	BDOS
	STA	DCNT
	INR	A
	RET
;
OPEN:	;open the file given by d,e
	MVI	C,OPENF
	JMP	BDSINR
;
OPENC:	;open comfcb
	XRA	A		;clear next record to read
	STA	COMREC
	LXI	D,COMFCB
	JMP	OPEN
;
CLOSE:	;close the file given by d,e
	MVI	C,CLOSEF
	JMP	BDSINR
;
SEARCH:	;search for the file given by d,e
	MVI	C,SEARF
	JMP	BDSINR
;
SRCHN:
	;search for the next occurrence of the file given by d,e
	MVI	C,SEARNF
	JMP	BDSINR
;
SRCHCM:
	;search for comfcb file
	LXI	D,COMFCB
	JMP	SEARCH
;
DELETE:	;delete the file given by d,e
	MVI	C,DELF
	JMP	BDOS
;
BDSCND:
	CALL	BDOS
	ORA	A
	RET
;
DSKRD:
	;read the next record from the file given by d,e
	MVI	C,DREADF
	JMP	BDSCND
;
DSKRDC:
	;read the comfcb file
	LXI	D,COMFCB
	JMP	DSKRD
;
DSKWR:
	;write the next record to the file given by d,e
	MVI	C,DWRITF
	JMP	BDSCND
;
MAKE:	;create the file given by d,e
	MVI	C,MAKEF
	JMP	BDSINR
;
RENAM:	;rename the file given by d,e
	MVI	C,RENF
	JMP	BDOS
;
GETUSR:
	;return current user code in a
	MVI	E,0FFH		;drop through to setuser
;
SETUSR:
	MVI	C,USERF		;sets user number
	JMP	BDOS
;
SAVUSR:
	;save user#/disk# before possible ^c or transient
	CALL	GETUSR		;code to a
	ADD	A		;rot left
	ADD	A
	ADD	A
	ADD	A
	LXI	H,CDISK		;4b=user, 4b=disk
	ORA	M
	STA	DTEFCB		;stored away in memory for later
	RET
;
SETDKA:
	LDA	CDISK		;user/disk
	STA	DTEFCB
	RET
;
XLATEC:
	;translate character in register A to upper case
	CPI	61H		;return if below lower case a
	RC
	CPI	7BH		;return if above lower case z
	RNC
	ANI	5FH		;translated to upper case
	RET
;
RDCOM:
	;read the next command into the command buffer
	;check for submit file
	LDA	SUBMIT
	ORA	A
	JZ	NOSUB
	;scanning a submit file
	;change drives to open and read the file
	LDA	CDISK
	ORA	A
	MVI	A,0
	CNZ	SELECT
	;have to open again in case xsub present
	LXI	D,SUBFCB	;skip if no sub
	CALL	OPEN
	JZ	NOSUB
	LDA	SUBRC		;read last record(s) first
	DCR	A
	STA	SUBCR		;current record to read
	LXI	D,SUBFCB	;end of file if last record
	CALL	DSKRD
	JNZ	NOSUB
	;disk read is ok, transfer to combuf
	LXI	D,COMLEN
	LXI	H,BUFF
	MVI	B,128
	CALL	MOVE0
	;line is transferred, close the file with a
	;deleted record
	LXI	H,SUBMOD	;clear fwflag
	MVI	M,0
	INX	H		;one less record
	DCR	M
	LXI	D,SUBFCB
	CALL	CLOSE
	JZ	NOSUB
	;close went ok, return to original drive
	LDA	CDISK
	ORA	A
	CNZ	SELECT
	;print to the 00
	LXI	H,COMBUF
	CALL	PRIN0
	CALL	BRKKEY
	JZ	NOREAD
	CALL	DELSUB		;break key depressed
	JMP	CCP
;
NOSUB:	;no submit file
	CALL	DELSUB
	;translate to upper case, store zero at end
	CALL	SAVUSR		;user # save in case control c
	MVI	C,RBUFF
	LXI	D,MAXLEN
	CALL	BDOS
	CALL	SETDKA		;no control c, so restore dtefcb
NOREAD:	;enter here from submit file
	;set the last character to zero for later scans
	LXI	H,COMLEN	;length is in b
	MOV	B,M
RDCOM0:
	INX	H		;end of scan?
	MOV	A,B
	ORA	A
	JZ	RDCOM1		;get character and translate
	MOV	A,M
	CALL	XLATEC
	MOV	M,A
	DCR	B
	JMP	RDCOM0
;
RDCOM1: ;end of scan, h,l address end of command
	MOV	M,A		;store a zero
	LXI	H,COMBUF	;ready to scan to zero
	SHLD	COMADR
	RET
;
BRKKEY:
	;check for a character ready at the console
	MVI	C,BREAKF
	CALL	BDOS
	ORA	A
	RZ
	MVI	C,RCHARF	;character cleared
	CALL	BDOS
	ORA	A
	RET
;
CSELT:
	;get the currently selected drive number to reg-A
	MVI	C,CSELF
	JMP	BDOS
;
SETBUF:
	;set default buffer dma address
	LXI	D,BUFF		;(drop through)
;
SETDMA:
	;set dma address to d,e
	MVI	C,DMAF
	JMP	BDOS
;
DELSUB:
	;delete the submit file, and set submit flag to false
	LXI	H,SUBMIT	;return if no sub file
	MOV	A,M
	ORA	A
	RZ
	MVI	M,0		;submit flag is set to false
	XRA	A		;on drive a to erase file
	CALL	SELECT
	LXI	D,SUBFCB
	CALL	DELETE
	LDA	CDISK		;back to original drive
	JMP	SELECT
;
COMERR:
	;error in command string starting at position
	;'staddr' and ending with first delimiter
	CALL	CRLF		;space to next line
	LHLD	STADDR		;h,l address first to print
COMER0: ;print characters until blank or zero
	MOV	A,M		;not blank
	CPI	' '
	JZ	COMER1
	ORA	A		;not zero, so print it
	JZ	COMER1
	PUSH	H
	CALL	PRTCHR
	POP	H
	INX	H
	JMP	COMER0		;for another character
COMER1: ;print question mark,and delete sub file
	MVI	A,'?'
	CALL	PRTCHR
	CALL	CRLF
	CALL	DELSUB
	JMP	CCP		;restart with next command
;
; fcb scan and fill subroutine (entry is at fillfcb below)
	;fill the comfcb, indexed by A (0 or 16)
	;subroutines
DELIM:	;look for a delimiter
	LDAX	D		;not the last element
	ORA	A
	RZ
	CPI	' '		;non graphic
	JC	COMERR
	RZ			;treat blank as delimiter
	CPI	'='
	RZ
	CPI	LA		;left arrow
	RZ
	CPI	'.'
	RZ
	CPI	':'
	RZ
	CPI	';'
	RZ
	CPI	'<'
	RZ
	CPI	'>'
	RZ
	RET			;delimiter not found
;
DEBLNK: ;deblank the input line
	LDAX	D		;treat end of line as blank
	ORA	A
	RZ
	CPI	' '
	RNZ
	INX	D
	JMP	DEBLNK
;
ADDH:	;add a to h,l
	ADD	L
	MOV	L,A
	RNC
	INR	H
	RET
;
FILFB0:
	;equivalent to fillfcb(0)
	MVI	A,0
;
FILFCB:
	LXI	H,COMFCB	;fcb rescanned at end
	CALL	ADDH
	PUSH	H
	PUSH	H
	XRA	A		;clear selected disk (in case A:...)
	STA	SDISK
	LHLD	COMADR		;command address in d,e
	XCHG
	CALL	DEBLNK		;to first non-blank character
	XCHG			;in case of errors
	SHLD	STADDR
	XCHG			;d,e has command, h,l has fcb address
	POP	H
	;look for preceding file name A: B: ...
	LDAX	D		;use current disk if empty command
	ORA	A
	JZ	SETCR0
	SUI	'A'-1		;disk name held in b if : follows
	MOV	B,A
	INX	D		;set disk name if :
	LDAX	D
	CPI	':'
	JZ	SETDRV
;
SETCUR: ;set current disk
	DCX	D		;back to first character of command
SETCR0:
	LDA	CDISK
	MOV	M,A
	JMP	SETNAM
;
SETDRV: ;set disk to name in register b
	MOV	A,B		;mark as disk selected
	STA	SDISK
	MOV	M,B		;past the :
	INX	D
;
SETNAM: ;set the file name field
	MVI	B,8		;file name length (max)
SETN0:
	CALL	DELIM		;not a delimiter
	JZ	PADNAM
	INX	H		;must be ?'s
	CPI	'*'
	JNZ	SETN1
	MVI	M,'?'		;to dec count
	JMP	SETN2
;
SETN1:
	MOV	M,A		;store character to fcb
	INX	D
SETN2:
	DCR	B		;count down length
	JNZ	SETN0
;
	;end of name, truncate remainder
TRNAME:	CALL	DELIM		;set type field if delimiter
	JZ	SETTY
	INX	D
	JMP	TRNAME
;
PADNAM:
	INX	H
	MVI	M,' '
	DCR	B
	JNZ	PADNAM
;
SETTY:	;set the type field
	MVI	B,3		;skip the type field if no .
	CPI	'.'
	JNZ	PADTY
	INX	D		;past the ., to the file type field
SETTY0: ;set the field from the command buffer
	CALL	DELIM
	JZ	PADTY
	INX	H
	CPI	'*'
	JNZ	SETTY1
	MVI	M,'?'		;since * specified
	JMP	SETTY2
;
SETTY1: ;not a *, so copy to type field
	MOV	M,A
	INX	D
SETTY2: ;decrement count and go again
	DCR	B
	JNZ	SETTY0
;
	;end of type field, truncate
TRTYP:	;truncate type field
	CALL	DELIM
	JZ	EFILL
	INX	D
	JMP	TRTYP
;
PADTY:	;pad the type field with blanks
	INX	H
	MVI	M,' '
	DCR	B
	JNZ	PADTY
;
EFILL:	;end of the filename/filetype fill, save command address
	;fill the remaining fields for the fcb
	MVI	B,3
EFILL0:	INX	H
	MVI	M,0
	DCR	B
	JNZ	EFILL0
	XCHG			;set new starting point
	SHLD	COMADR
;
	;recover the start address of the fcb and count ?'s
	POP	H		;b=0, c=8+3
	LXI	B,11
SCNQ:	INX	H
	MOV	A,M
	CPI	'?'
	JNZ	SCNQ0
	;? found, count it in b
	INR	B
SCNQ0:	DCR	C
	JNZ	SCNQ
;
	;number of ?'s in c, move to a and return with flags set
	MOV	A,B
	ORA	A
	RET
;
INTVEC:
	;intrinsic function names (all are four characters)
	DB	'DIR '
	DB	'ERA '
	DB	'TYPE'
	DB	'SAVE'
	DB	'REN '
	DB	'USER'
INTLEN	EQU	6		;intrinsic function count
;
INTRIN:
	;look for intrinsic functions (comfcb has been filled)
	LXI	H,INTVEC	;c counts intrinsics as scanned
	MVI	C,0
INTR0:
	MOV	A,C		;done with scan?
	CPI	INTLEN
	RNC
	;no, more to scan
	LXI	D,COMFCB+1	;beginning of name
	MVI	B,4		;length of match is in b
INTR1:
	LDAX	D		;match?
	CMP	M
	JNZ	INTR2		;skip if no match
	INX	D
	INX	H
	DCR	B
	JNZ	INTR1		;loop while matching
;
	;complete match on name, check for blank in fcb
	LDAX	D		;otherwise matched
	CPI	' '
	JNZ	INTR3
	MOV	A,C		;with intrinsic number in a
	RET
;
INTR2:	;mismatch, move to end of intrinsic
	INX	H
	DCR	B
	JNZ	INTR2
;
INTR3:	;try next intrinsic
	INR	C		;to next intrinsic number
	JMP	INTR0		;for another round
;
CCPCLR:
	;clear the command buffer
	XRA	A
	STA	COMLEN
	;drop through to start ccp
CCPSTA:
	;enter here from boot loader
	LXI	SP,STACK	;save initial disk number
	PUSH	B
	;(high order 4bits=user code, low 4bits=disk#)
	MOV	A,C		;user code
	RAR
	RAR
	RAR
	RAR
	ANI	0FH
;
	MOV	E,A		;user code selected
	CALL	SETUSR
	;initialize for this user, get $ flag
	CALL	INITLZ		;0ffh in accum if $ file present
	STA	SUBMIT		;submit flag set if $ file present
	POP	B		;recall user code and disk number
	MOV	A,C		;disk number in accumulator
	ANI	0FH
	STA	CDISK		;clears user code nibble
	CALL	SELECT		;proper disk is selected
	;check for initial command
	LDA	COMLEN		;assume typed already
	ORA	A
	JNZ	CCP0
;
CCP:
	;enter here on each command or error condition
	LXI	SP,STACK
	CALL	CRLF		;print d> prompt, where d is disk name
	CALL	CSELT		;get current disk number
	ADI	'A'
	CALL	PRTCHR
	MVI	A,'>'
	CALL	PRTCHR
	CALL	RDCOM		;command buffer filled
CCP0:	;(enter here from initialization with command full)
	LXI	D,BUFF		;default dma address at buff
	CALL	SETDMA
	CALL	CSELT		;current disk number saved
	STA	CDISK
	CALL	FILFB0		;command fcb filled
	CNZ	COMERR		;the name cannot be an ambiguous reference
	LDA	SDISK
	ORA	A
	JNZ	USRFNC
	;check for an intrinsic function
	CALL	INTRIN
	LXI	H,JMPTAB	;index is in the accumulator
	MOV	E,A		;index in d,e
	MVI	D,0
	DAD	D
	DAD	D
	MOV	A,M
	INX	H
	MOV	H,M
	MOV	L,A
	PCHL
	;pc changes to the proper intrinsic or user function
;
JMPTAB:
	DW	DIRECT		;directory search
	DW	ERASE		;file erase
	DW	TYPE		;type file
	DW	SAVE		;save memory image
	DW	RENAME		;file rename
	DW	USER		;user number
	DW	USRFNC		;user-defined function
;
;utility subroutines for intrinsic handlers
RDERR:
	;print the read error message
	LXI	B,RDMSG
	JMP	PRINT
RDMSG:	DB	'READ ERROR',0
;
NOFILE:
	;print no file message
	LXI	B,NOFMSG
	JMP	PRINT
NOFMSG: DB	'NO FILE',0
;
GETNUM: ;read a number from the command line
	CALL	FILFB0		;should be number
	LDA	SDISK		;cannot be prefixed
	ORA	A
	JNZ	COMERR
	;convert the byte value in comfcb to binary
	LXI	H,COMFCB+1	;(b=0, c=11)
	LXI	B,11
	;value accumulated in b, c counts name length to zero
CONV0:	MOV	A,M
	CPI	' '
	JZ	CONV1
	;more to scan, convert char to binary and add
	INX	H		;valid?
	SUI	'0'
	CPI	10
	JNC	COMERR
	MOV	D,A		;save value
	MOV	A,B		;mult by 10
	ANI	0E0H
	JNZ	COMERR
	MOV	A,B		;recover value
	RLC			;*8
	RLC
	RLC
	ADD	B
	JC	COMERR
	ADD	B		;*8+*2 = *10
	JC	COMERR
	ADD	D		;+digit
	JC	COMERR
	MOV	B,A		;for another digit
	DCR	C
	JNZ	CONV0
	RET
CONV1:	;end of digits, check for all blanks
	MOV	A,M		;blanks?
	CPI	' '
	JNZ	COMERR
	INX	H
	DCR	C
	JNZ	CONV1
	MOV	A,B		;recover value
	RET
;
MOVNAM:
	;move 3 characters from h,l to d,e addresses
	MVI	B,3
MOVE0:	MOV	A,M
	STAX	D
	INX	H
	INX	D
	DCR	B
	JNZ	MOVE0
	RET
;
ADDHCF:	;buff + a + c to h,l followed by fetch
	LXI	H,BUFF
	ADD	C
	CALL	ADDH
	MOV	A,M
	RET
;
SETDSK:
	;change disks for this command, if requested
	XRA	A		;clear disk name from fcb
	STA	COMFCB
	LDA	SDISK		;no action if not specified
	ORA	A
	RZ
	DCR	A		;already selected
	LXI	H,CDISK
	CMP	M
	RZ
	JMP	SELECT
;
RSTDSK:
	;return to original disk after command
	LDA	SDISK		;no action if not selected
	ORA	A
	RZ
	DCR	A		;same disk
	LXI	H,CDISK
	CMP	M
	RZ
	LDA	CDISK
	JMP	SELECT
;
;individual intrinsics follow
DIRECT:
	;directory search
	CALL	FILFB0		;comfcb gets file name
	CALL	SETDSK		;change disk drives if requested
	LXI	H,COMFCB+1	;may be empty request
	MOV	A,M
	CPI	' '		;skip fill of ??? if not blank
	JNZ	DIR1
	;set comfcb to all ??? for current disk
	MVI	B,11		;length of fill ????????.???
DIR0:	MVI	M,'?'
	INX	H
	DCR	B
	JNZ	DIR0
	;not a blank request, must be in comfcb
DIR1:	MVI	E,0		;E counts directory entries
	PUSH	D
	CALL	SRCHCM		;first one has been found
	CZ	NOFILE		;not found message
DIR2:	JZ	ENDIR
	;found, but may be system file
	LDA	DCNT		;get the location of the element
	RRC
	RRC
	RRC
	ANI	60H
	MOV	C,A
	;c contains base index into buff for dir entry
	MVI	A,SYSFIL	;value to A
	CALL	ADDHCF
	RAL			;skip if system file
	JC	DIR6
	;c holds index into buffer
	;another fcb found, new line?
	POP	D
	MOV	A,E
	INR	E
	PUSH	D
	;e=0,1,2,3,...new line if mod 4 = 0
	ANI	03H		;and save the test
	PUSH	PSW
	JNZ	DIRHD0		;header on current line
	CALL	CRLF
	PUSH	B
	CALL	CSELT
	POP	B
	;current disk in A
	ADI	'A'
	CALL	PRTBC
	MVI	A,':'
	CALL	PRTBC
	JMP	DIRHD1		;skip current line hdr
DIRHD0:
	CALL	BLANK		;after last one
	MVI	A,':'
	CALL	PRTBC
DIRHD1:
	CALL	BLANK
	;compute position of name in buffer
	MVI	B,1		;start with first character of name
DIR3:	MOV	A,B		;buff+a+c fetched
	CALL	ADDHCF
	ANI	7FH		;mask flags
	;may delete trailing blanks
	CPI	' '		;check for blank type
	JNZ	DIR4
	POP	PSW		;may be 3rd item
	PUSH	PSW
	CPI	3		;place blank at end if not
	JNZ	DIRB
	MVI	A,9		;first char of type
	CALL	ADDHCF
	ANI	7FH
	CPI	' '
	JZ	DIR5
	;not a blank in the file type field
DIRB:	MVI	A,' '		;restore trailing filename chr
DIR4:
	CALL	PRTBC		;char printed
	INR	B
	MOV	A,B
	CPI	12
	JNC	DIR5
	;check for break between names
	CPI	9		;for another char
	JNZ	DIR3
	;print a blank between names
	CALL	BLANK
	JMP	DIR3
;
DIR5:	;end of current entry
	POP	PSW		;discard the directory counter (mod 4)
DIR6:	CALL	BRKKEY		;check for interrupt at keyboard
	JNZ	ENDIR		;abort directory search
	CALL	SRCHN		;for another entry
	JMP	DIR2
ENDIR:	;end of directory scan
	POP	D		;discard directory counter
	JMP	RETCOM
;
;
ERASE:
	CALL	FILFB0		;cannot be all ???'s
	CPI	11
	JNZ	ERAFIL
	;erasing all of the disk
	LXI	B,ERMSG
	CALL	PRINT
	CALL	RDCOM
	LXI	H,COMLEN	;bad input
	DCR	M
	JNZ	CCP
	INX	H
	MOV	A,M
	CPI	'Y'
	JNZ	CCP
	;ok, erase the entire diskette
	INX	H		;otherwise error at retcom
	SHLD	COMADR
ERAFIL:
	CALL	SETDSK
	LXI	D,COMFCB
	CALL	DELETE
	INR	A		;255 returned if not found
	CZ	NOFILE		;no file message if so
	JMP	RETCOM
;
ERMSG:	DB	'ALL (Y/N)?',0
;
TYPE:
	CALL	FILFB0		;don't allow ?'s in file name
	JNZ	COMERR
	CALL	SETDSK		;open the file
	CALL	OPENC
	JZ	TYPERR		;zero flag indicates not found
	;file opened, read 'til eof
	CALL	CRLF		;read first buffer
	LXI	H,BPTR
	MVI	M,255
TYPE0:	;loop on bptr
	LXI	H,BPTR		;end buffer
	MOV	A,M
	CPI	128
	JC	TYPE1		;carry if 0,1,...,127
	PUSH	H
	;read another buffer full
	CALL	DSKRDC
	POP	H		;recover address of bptr
	JNZ	TYPEOF		;hard end of file
	XRA	A		;bptr = 0
	MOV	M,A
TYPE1:	;read character at bptr and print
	INR	M		;bptr = bptr + 1
	LXI	H,BUFF		;h,l addresses char
	CALL	ADDH
	MOV	A,M
	CPI	EOFILE
	JZ	RETCOM
	CALL	PRTCHR
	CALL	BRKKEY		;abort if break
	JNZ	RETCOM
	JMP	TYPE0		;for another character
;
TYPEOF:	;end of file, check for errors
	DCR	A
	JZ	RETCOM
	CALL	RDERR
TYPERR:	CALL	RSTDSK
	JMP	COMERR
;
SAVE:
	CALL	GETNUM		;value to register a
	PUSH	PSW		;save it for later
;
	;should be followed by a file to save the memory image
	CALL	FILFB0
	JNZ	COMERR		;cannot be ambiguous
	CALL	SETDSK		;may be a disk change
	LXI	D,COMFCB	;existing file removed
	PUSH	D
	CALL	DELETE
	POP	D
	CALL	MAKE		;create a new file on disk
	JZ	SAVERR		;no directory space
	XRA	A		;clear next record field
	STA	COMREC
	POP	PSW		;#pages to write is in a, change to #sectors
	MOV	L,A
	MVI	H,0
	DAD	H
	LXI	D,TRAN		;h,l is sector count, d,e is load address
SAVE0:	;check for sector count zero
	MOV	A,H		;may be completed
	ORA	L
	JZ	SAVE1
	DCX	H		;sector count = sector count - 1
	PUSH	H		;save it for next time around
	LXI	H,128		;next dma address saved
	DAD	D
	PUSH	H
	CALL	SETDMA		;current dma address set
	LXI	D,COMFCB
	CALL	DSKWR
	POP	D		;dma address, sector count
	POP	H
	JNZ	SAVERR		;may be disk full case
	JMP	SAVE0		;for another sector
;
SAVE1:	;end of dump, close the file
	LXI	D,COMFCB
	CALL	CLOSE
	INR	A		;255 becomes 00 if error
	JNZ	RETSAV		;for another command
SAVERR:	;must be full or read only disk
	LXI	B,FLMSG
	CALL	PRINT
RETSAV:
	;reset dma buffer
	CALL	SETBUF
	JMP	RETCOM
FLMSG:
	DB	'NO SPACE',0
;
;
RENAME:
	;rename a file on a specific disk
	CALL	FILFB0		;must be unambiguous
	JNZ	COMERR
	LDA	SDISK		;save for later compare
	PUSH	PSW
	CALL	SETDSK		;disk selected
	CALL	SRCHCM		;is new name already there?
	JNZ	RENER3
	;file doesn't exist, move to second half of fcb
	LXI	H,COMFCB
	LXI	D,COMFCB+16
	MVI	B,16
	CALL	MOVE0
	;check for = or left arrow
	LHLD	COMADR
	XCHG
	CALL	DEBLNK
	CPI	'='		;ok if =
	JZ	REN1
	CPI	LA
	JNZ	RENER2
REN1:	XCHG			;past delimiter
	INX	H
	SHLD	COMADR
	;proper delimiter found
	CALL	FILFB0
	JNZ	RENER2
	;check for drive conflict
	POP	PSW		;previous drive number
	MOV	B,A
	LXI	H,SDISK
	MOV	A,M
	ORA	A
	JZ	REN2
	;drive name was specified.  same one?
	CMP	B
	MOV	M,B
	JNZ	RENER2
REN2:	MOV	M,B		;store the name in case drives switched
	XRA	A		;is old file there?
	STA	COMFCB
	CALL	SRCHCM
	JZ	RENER1
;
	;everything is ok, rename the file
	LXI	D,COMFCB
	CALL	RENAM
	JMP	RETCOM
;
RENER1:	;no file on disk
	CALL	NOFILE
	JMP	RETCOM
RENER2:	;ambiguous reference/name conflict
	CALL	RSTDSK
	JMP	COMERR
RENER3:	;file already exists
	LXI	B,RENMSG
	CALL	PRINT
	JMP	RETCOM
RENMSG:	DB	'FILE EXISTS',0
;
USER:
	;set user number
	CALL	GETNUM		;leaves the value in the accumulator
	CPI	16		;must be between 0 and 15
	JNC	COMERR
	MOV	E,A		;save for setuser call
	LDA	COMFCB+1
	CPI	' '
	JZ	COMERR
	CALL	SETUSR		;new user number set
	JMP	ENDCOM
;
USRFNC:
	;load user function and set up for execution
	LDA	COMFCB+1
	CPI	' '
	JNZ	USER0
	;no file name, but may be disk switch
	LDA	SDISK		;no disk name if 0
	ORA	A
	JZ	ENDCOM
	DCR	A		;set user/disk
	STA	CDISK
	CALL	SETDKA
	CALL	SELECT
	JMP	ENDCOM
USER0:	;file name is present
	LXI	D,COMFCB+9	;type ' '
	LDAX	D
	CPI	' '
	JNZ	COMERR
	PUSH	D		;.com
	CALL	SETDSK
	POP	D
	LXI	H,COMTYP
	CALL	MOVNAM		;file type is set to .com
	CALL	OPENC
	JZ	USERER
	;file opened properly, read it into memory
	LXI	H,TRAN		;transient program base
LOAD0:	PUSH	H		;save dma address
	XCHG
	CALL	SETDMA
	LXI	D,COMFCB
	CALL	DSKRD
	JNZ	LOAD1
	;sector loaded, set new dma address and compare
	POP	H
	LXI	D,128
	DAD	D
	LXI	D,TRANM		;has the load overflowed?
	MOV	A,L
	SUB	E
	MOV	A,H
	SBB	D
	JNC	LODERR
	JMP	LOAD0		;for another sector
;
LOAD1:	POP	H		;end file is 1
	DCR	A
	JNZ	LODERR
	CALL	RSTDSK		;back to original disk
	CALL	FILFB0
	LXI	H,SDISK
	PUSH	H
	MOV	A,M		;drive number set
	STA	COMFCB
	MVI	A,16		;move entire fcb to memory
	CALL	FILFCB
	POP	H
	MOV	A,M
	STA	COMFCB+16
	XRA	A		;record number set to zero
	STA	COMREC
	LXI	D,FCB
	LXI	H,COMFCB
	MVI	B,33
	CALL	MOVE0
	;move command line to buff
	LXI	H,COMBUF
BMOV0:	MOV	A,M
	ORA	A
	JZ	BMOV1
	CPI	' '
	JZ	BMOV1
	INX	H		;for another scan
	JMP	BMOV0
	;first blank position found
BMOV1:	MVI	B,0		;ready for the move
	LXI	D,BUFF+1
BMOV2:	MOV	A,M
	STAX	D
	ORA	A
	JZ	BMOV3
	;more to move
	INR	B
	INX	H
	INX	D
	JMP	BMOV2
BMOV3:	;b has character count
	MOV	A,B
	STA	BUFF
	CALL	CRLF
	;now go to the loaded program
	CALL	SETBUF		;default dma
	CALL	SAVUSR		;user code saved
	;low memory dtefcb contains user code
	CALL	TRAN		;gone to the loaded program
	LXI	SP,STACK	;may come back here
	CALL	SETDKA
	CALL	SELECT
	JMP	CCP
;
USERER:	;arrive here on command error
	CALL	RSTDSK
	JMP	COMERR
;
LODERR:	;cannot load the program
	LXI	B,LODMSG
	CALL	PRINT
	JMP	RETCOM
LODMSG:
	DB	'BAD LOAD',0
COMTYP:
	DB	'COM'		;for com files
;
;
RETCOM:	;reset disk before end of command check
	CALL	RSTDSK
;
ENDCOM:	;end of intrinsic command
	CALL	FILFB0		;to check for garbage at end of line
	LDA	COMFCB+1
	SUI	' '
	LXI	H,SDISK
	ORA	M
	;0 in accumulator if no disk selected, and blank fcb
	JNZ	COMERR
	JMP	CCP
;
;
;	data areas
	DS	16		;8 level stack
STACK:
;
;	'submit' file control block
SUBMIT:	DB	0		;00 if no submit file, ff if submitting
SUBFCB:	DB	0,'$$$     '	;file name is $$$
	DB	'SUB',0,0	;file type is sub
SUBMOD:	DB	0		;module number
SUBRC:	DS	1		;record count filed
	DS	16		;disk map
SUBCR:	DS	1		;current record to read
;
;	command file control block
COMFCB:	DS	32		;fields filled in later
COMREC:	DS	1		;current record to read/write
DCNT:	DS	1		;disk directory count (used for error codes)
CDISK:	DS	1		;current disk
SDISK:	DS	1		;selected disk for current operation
			;none=0, a=1, b=2 ...
BPTR:	DS	1		;buffer pointer
;
	END
