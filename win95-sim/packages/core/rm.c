/*
 * R M . C
 *
 * File deletion utility
 *
 * This routine is a file deletion program for the CP/M-80 environment
 * that operates more or less in the style of UNIX (tm of AT&T) "rm". 
 *
 *  Usage: rm [-f] [-i] [-q] [-] [s:]filename [filename...]
 *
 *	        s: => Expand afn only with SYStem attribute files
 *		-f => Delete files, even if read-only
 *		-i => Interactive query before deleting each file
 *		-q => Quiet mode
 *		-  => Designates that filenames follow
 *
 * The distributed compiled version of this program used the M. Kersenbrock
 * version of croot.c where the filenames are Unix-like regular-expression
 * filenames.  The 's:' handling is done by that croot.c .  Afn expansion
 * normally expands ONLY non-SYS attribute files ("DIR" or "normal" files).
 * 's:' forces expansion to ONLY SYS attribute files.
 *
 * The handling of "SYStem attribute" and "R/O" are those defined under
 * CP/M 3.0, although this program should be compatible with CP/M 2.2 .
 *
 * The compiled binary, when run under CP/M 3.0, will set the system
 * error-status upon error to that value handled by the CCP105 
 * CCP replacement for reasons explained there (if you use CP/M 3.0
 * and haven't replaced your CCP with CCP105, then you're working
 * too hard!).  
 *
 * (C) Copyright 1987 by Michael D. Kersenbrock, Aloha, Oregon.  All rights
 * reserved.
 *
 * This program may be freely distributed for non-commercial purposes 
 * so long as this notice is retained in its entirety.
 */


#include "c:stdio.h" 		/* I keep'em in the RAMDISK 		  */

#ifndef POSTERROR
#define POSTERROR 0xff12	/* Error that the colon processor uses    */
#endif

#define TRUE 1
#define FALSE 0
#define VERSION "1.04"
#define RO_FLAG (0x80 & Fcb[9]) /* CP/M 3.0 R/O flag			  */

char Reply_buf[] = "\006        ";	/* Buffer for 'y/n' queries	  */
char Forceflag = FALSE;			/* remove r/o files when TRUE     */
char Interactive = FALSE;		/* query for each file, when TRUE */
char Quiet = FALSE;			/* no "xx deleted" msgs when TRUE */
char Fcb[36];
char getreply();

main(argc, argv)
int argc;
char *argv[];
{
	register int loop;
	char file,c;

	for (loop = 1, file = FALSE ; loop < argc && file == FALSE ; loop++) {
		if (*argv[loop] == '-') {
			switch(tolower(*(argv[loop]+1))) {
				/*
				 * Plain dash means "all following are
				 * filenames"
				 */
			  case '\0':    file = TRUE;
			  		break;

				/*
				 * '-f' means to override anything Read/Only
				 */
			  case  'f':
					Forceflag = TRUE;
					break;

				/*
				 * '-i' means to delete files interactively
				 */
			  case 'i':
					Interactive = TRUE;
				        break;

				/*
				 * '-q' means not to be verbose
				 */
			  case 'q':
					Quiet = TRUE;
					break;

			   default:
					fputs("Unknown option: ",stderr);
					fputs(argv[loop],stderr);
					usage();
					exit(POSTERROR);
			}
		}
		else {
			loop--;
			file = TRUE;
		}
	}

	if (loop >= argc || argc <= 1) {
		fputs("\nFilename\(s\) are missing\n",stderr);
		usage(0);
		exit(POSTERROR);
	}

	/*
	 * At this point, argv[loop] should be the first file to operate on.
	 */
	for ( ; loop < argc ; loop++) {
		/*
		 * Try to open the file
		 */
		fcbinit(argv[loop],Fcb);

		/*
		 * Note difference between CP/M 2.2 and 3.0:
		 * 2.2 => Returns 0<->3 with successful open, 0xff with error
		 * 3.0 => Returns ONLY 0  with successful open, 0xff with error
		 *
		 * Lesson: don't look for the zero "good return".  :-)
		 */
		if (bdos(0x0f,Fcb) == 0xff) {
			fputs("File: ",stderr);
			fputs(argv[loop],stderr);
			fputs(" not found\n",stderr);
			continue;
		}

		/*
		 * Poll to see if a CTL-C (abort) has been posted
		 */
		chekkbd();

		/*
		 * Be neat, and close file if it opened OK
		 */
		bdos(0x10,Fcb);
		
		if (RO_FLAG != 0 && Forceflag == FALSE) {
			fputs("File: ",stderr);
			fputs(argv[loop],stderr);
			fputs(" is R/O \n",stderr);
			continue;

		}
		else if (Interactive == TRUE) {
			fputs("File: ",stdout);
			fputs(argv[loop],stdout);
			fputs(" , delete \(y/n\)? ",stdout);
			if (tolower(getreply()) != 'y') {
				putchar('\n');				
				continue;
			}
			fputs("\t\t\t\t\t\r",stdout);
		}
		if (RO_FLAG != 0 && Forceflag == TRUE) {
			/*
			 * Make file R/W 
			 */
			Fcb[9] &= 0x7f;
			bdos(0x1e,Fcb);
		}
		unlink(argv[loop]);
		if (Quiet != TRUE) {
			fputs("File: ",stdout);
			fputs(argv[loop],stdout);
			fputs(" deleted\n",stdout);
		}
	}
	exit(0);
}

usage() {
	fputs("\nReMove file utility\t Version: ",stderr);
	fputs(VERSION,stderr);
	fputs("\t\t(c) 1987 M. Kersenbrock",stderr);
	fputs("\n\nUsage: rm [-f] [-i] [-q] [-] [s:]filename [filename...]",
								      stderr);
	fputs("\n\t\ts: => Expand afn only with SYStem attribute files",
								      stderr);
	fputs("\n\t\t-f => Delete files, even if read-only",stderr);
	fputs("\n\t\t-i => Query before deleting each file",stderr);
	fputs("\n\t\t-q => \"Quiet\" mode",stderr);
	fputs("\n\t\t-  => Designates that filenames follow\n",stderr);
}


char
getreply() {
	bdos(0x0a,Reply_buf);	/* Get a line of edited input from console */
	if (Reply_buf[1] >= 1)
		return(Reply_buf[2]);
	return(0);
}
