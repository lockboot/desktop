//! CP/M Emulator - integrates Z80 CPU with BDOS handling.

use std::num::NonZeroU16;

use z80emu::host::TsCounter;
use z80emu::{Clock, Cpu, Io, Memory, Reg8, StkReg16, Z80NMOS};

use crate::bdos::{addr, BdosFunction, Fcb, RECORD_SIZE};
use crate::console::CpmConsole;
use crate::error::CpmResult;
use crate::fs::DriveFS;
use crate::{CpmExitInfo, ExitReason};

/// Type alias for the clock.
type TsClock = TsCounter<i32>;

/// CP/M Emulator bus - memory + I/O.
struct Bus<'a, C: CpmConsole, D: DriveFS> {
    memory: &'a mut [u8; 65536],
    console: &'a mut C,
    drives: &'a mut [Option<D>; 16],
    current_drive: &'a mut u8,
    current_user: &'a mut u8,
    dma: &'a mut u16,
    dir_entries: &'a mut Vec<String>,
    dir_index: &'a mut usize,
    search_pattern_name: &'a mut [u8; 8],
    search_pattern_ext: &'a mut [u8; 3],
    search_drive: &'a mut u8,
    open_files: &'a mut Vec<(u8, String, Vec<u8>, bool)>,
    trace: bool,
}

impl<C: CpmConsole, D: DriveFS> Memory for Bus<'_, C, D> {
    type Timestamp = i32;

    fn read_debug(&self, addr: u16) -> u8 {
        self.memory[addr as usize]
    }

    fn read_mem(&self, addr: u16, _ts: Self::Timestamp) -> u8 {
        self.memory[addr as usize]
    }

    fn write_mem(&mut self, addr: u16, value: u8, _ts: Self::Timestamp) {
        self.memory[addr as usize] = value;
    }
}

impl<C: CpmConsole, D: DriveFS> Io for Bus<'_, C, D> {
    type Timestamp = i32;
    type WrIoBreak = ();
    type RetiBreak = ();

    fn read_io(&mut self, _port: u16, _ts: Self::Timestamp) -> (u8, Option<NonZeroU16>) {
        (0xFF, None)
    }

    fn write_io(
        &mut self,
        _port: u16,
        _value: u8,
        _ts: Self::Timestamp,
    ) -> (Option<Self::WrIoBreak>, Option<NonZeroU16>) {
        (None, None)
    }
}

/// CP/M Emulator state.
pub struct CpmEmulator<C: CpmConsole, D: DriveFS> {
    /// Z80 CPU.
    cpu: Z80NMOS,
    /// Clock/T-state counter.
    clock: TsClock,
    /// 64KB memory.
    memory: [u8; 65536],
    /// Console for I/O.
    console: C,
    /// Drives (A-P).
    drives: [Option<D>; 16],
    /// Current drive (0 = A, 1 = B, ...).
    current_drive: u8,
    /// Current user number (0-15).
    current_user: u8,
    /// DMA address for file operations.
    dma: u16,
    /// Directory search state.
    dir_entries: Vec<String>,
    dir_index: usize,
    search_pattern_name: [u8; 8],
    search_pattern_ext: [u8; 3],
    search_drive: u8,
    /// Open file handles: (drive, filename, data, modified).
    open_files: Vec<(u8, String, Vec<u8>, bool)>,
    /// Shell binary for warm boot reload.
    shell_binary: Option<Vec<u8>>,
    /// Shell load address.
    shell_address: u16,
    /// Enable syscall tracing.
    pub trace: bool,
}

impl<C: CpmConsole, D: DriveFS> CpmEmulator<C, D> {
    /// Create a new emulator with the given console.
    pub fn new(console: C) -> Self {
        let mut emu = Self {
            cpu: Z80NMOS::default(),
            clock: TsClock::default(),
            memory: [0; 65536],
            console,
            // Initialize array of None values without requiring Default
            drives: [
                None, None, None, None, None, None, None, None, None, None, None, None, None, None,
                None, None,
            ],
            current_drive: 0,
            current_user: 0,
            dma: addr::DEFAULT_DMA,
            dir_entries: Vec::new(),
            dir_index: 0,
            search_pattern_name: [b' '; 8],
            search_pattern_ext: [b' '; 3],
            search_drive: 0,
            open_files: Vec::new(),
            shell_binary: None,
            shell_address: addr::TPA,
            trace: false,
        };
        emu.init_memory();
        emu
    }

    /// Initialize memory with CP/M system vectors.
    fn init_memory(&mut self) {
        // JP 0 at warm boot vector
        self.memory[0x0000] = 0xC3; // JP
        self.memory[0x0001] = 0x00;
        self.memory[0x0002] = 0x00;

        // IOBYTE at 0x0003
        self.memory[0x0003] = 0x00;

        // Current drive at 0x0004
        self.memory[0x0004] = 0x00;

        // JP BDOS at 0x0005
        self.memory[0x0005] = 0xC3; // JP
        self.memory[0x0006] = (addr::BDOS & 0xFF) as u8;
        self.memory[0x0007] = (addr::BDOS >> 8) as u8;

        // BDOS entry - RET (we intercept before this)
        self.memory[addr::BDOS as usize] = 0xC9; // RET

        // CBIOS entry points - all RET
        for i in 0..17 {
            let addr = addr::CBIOS as usize + i * 3;
            self.memory[addr] = 0xC9; // RET
        }
    }

    /// Mount a drive.
    pub fn mount(&mut self, drive: u8, fs: D) {
        if drive < 16 {
            self.drives[drive as usize] = Some(fs);
        }
    }

    /// Unmount a drive.
    pub fn unmount(&mut self, drive: u8) {
        if drive < 16 {
            self.drives[drive as usize] = None;
        }
    }

    /// Get a reference to a drive's filesystem.
    pub fn drive(&self, drive: u8) -> Option<&D> {
        self.drives.get(drive as usize).and_then(|d| d.as_ref())
    }

    /// Get a mutable reference to a drive's filesystem.
    pub fn drive_mut(&mut self, drive: u8) -> Option<&mut D> {
        self.drives.get_mut(drive as usize).and_then(|d| d.as_mut())
    }

    /// Get console reference.
    pub fn console(&self) -> &C {
        &self.console
    }

    /// Get mutable console reference.
    pub fn console_mut(&mut self) -> &mut C {
        &mut self.console
    }

    /// Load a COM file into memory at TPA (0x0100).
    pub fn load_com(&mut self, data: &[u8]) {
        self.load_at(addr::TPA, data);
    }

    /// Load binary data into memory at a specific address.
    pub fn load_at(&mut self, address: u16, data: &[u8]) {
        let start = address as usize;
        let end = (start + data.len()).min(self.memory.len());
        self.memory[start..end].copy_from_slice(&data[..end - start]);
    }

    /// Set the shell binary for warm boot reload.
    /// When a program exits via warm boot, the shell will be reloaded and execution continues.
    pub fn set_shell(&mut self, data: &[u8], address: u16) {
        self.shell_binary = Some(data.to_vec());
        self.shell_address = address;
        self.load_at(address, data);
    }

    /// Set the program counter (where execution starts).
    pub fn set_pc(&mut self, address: u16) {
        self.cpu.set_pc(address);
    }

    /// Set command line arguments.
    /// Args are stored at 0x0080 (length byte + text).
    pub fn set_args(&mut self, args: &str) {
        let args_upper = args.to_uppercase();
        let bytes = args_upper.as_bytes();
        let len = bytes.len().min(127);

        self.memory[addr::CMDLINE as usize] = len as u8;
        self.memory[addr::CMDLINE as usize + 1..addr::CMDLINE as usize + 1 + len]
            .copy_from_slice(&bytes[..len]);
    }

    /// Run until program exits, starting at TPA (0x0100).
    pub fn run(&mut self) -> CpmResult<CpmExitInfo> {
        self.run_from(addr::TPA)
    }

    /// Run until program exits, starting at the specified address.
    /// If a shell is set, warm boot reloads the shell and continues.
    /// Otherwise, warm boot exits.
    pub fn run_from(&mut self, start_address: u16) -> CpmResult<CpmExitInfo> {
        // Set PC to start address
        self.cpu.reset();
        self.cpu.set_pc(start_address);

        // Set SP to just below BDOS
        self.cpu.set_sp(addr::BDOS - 2);

        loop {
            let pc = self.cpu.get_pc();

            // Check for BDOS/CBIOS intercept BEFORE executing
            match pc {
                _ if pc == addr::BDOS => {
                    let exit = self.handle_bdos()?;
                    if let Some(info) = exit {
                        // Check if we should reload shell on warm boot
                        if info.reason == ExitReason::WarmBoot {
                            if let Some(ref shell) = self.shell_binary {
                                self.warm_boot_reload(shell.clone());
                                continue;
                            }
                        }
                        return Ok(info);
                    }
                    // Return from BDOS call
                    let ret_addr = self.pop16();
                    self.cpu.set_pc(ret_addr);
                    continue;
                }
                _ if pc >= addr::CBIOS => {
                    let exit = self.handle_cbios()?;
                    if let Some(info) = exit {
                        // Check if we should reload shell on warm boot
                        if info.reason == ExitReason::WarmBoot {
                            if let Some(ref shell) = self.shell_binary {
                                self.warm_boot_reload(shell.clone());
                                continue;
                            }
                        }
                        return Ok(info);
                    }
                    // Return from CBIOS call
                    let ret_addr = self.pop16();
                    self.cpu.set_pc(ret_addr);
                    continue;
                }
                0x0000 => {
                    // Warm boot - reload shell if available
                    if let Some(ref shell) = self.shell_binary {
                        self.warm_boot_reload(shell.clone());
                        continue;
                    }
                    return Ok(CpmExitInfo {
                        reason: ExitReason::WarmBoot,
                        t_states: self.clock.as_timestamp() as u64,
                        pc: 0,
                    });
                }
                _ => {}
            }

            // Execute instruction
            let mut bus = Bus {
                memory: &mut self.memory,
                console: &mut self.console,
                drives: &mut self.drives,
                current_drive: &mut self.current_drive,
                current_user: &mut self.current_user,
                dma: &mut self.dma,
                dir_entries: &mut self.dir_entries,
                dir_index: &mut self.dir_index,
                search_pattern_name: &mut self.search_pattern_name,
                search_pattern_ext: &mut self.search_pattern_ext,
                search_drive: &mut self.search_drive,
                open_files: &mut self.open_files,
                trace: self.trace,
            };

            let _result =
                self.cpu
                    .execute_next(&mut bus, &mut self.clock, None::<fn(z80emu::CpuDebug)>);

            // Check for HALT instruction
            if self.cpu.is_halt() {
                self.flush_open_files();
                return Ok(CpmExitInfo {
                    reason: ExitReason::Halt,
                    t_states: self.clock.as_timestamp() as u64,
                    pc: self.cpu.get_pc(),
                });
            }
        }
    }

    /// Reload shell after warm boot.
    fn warm_boot_reload(&mut self, shell: Vec<u8>) {
        // Close all open files (flush writes)
        self.flush_open_files();

        // Reload shell at its address
        self.load_at(self.shell_address, &shell);

        // Re-initialize memory vectors
        self.init_memory();

        // Reset DMA to default
        self.dma = addr::DEFAULT_DMA;

        // Reset CPU and set PC to shell
        self.cpu.reset();
        self.cpu.set_pc(self.shell_address);
        self.cpu.set_sp(addr::BDOS - 2);

        // Clear command line
        self.memory[addr::CMDLINE as usize] = 0;
    }

    /// Flush and close all open files.
    fn flush_open_files(&mut self) {
        for (drive, filename, data, modified) in self.open_files.drain(..) {
            if modified {
                if let Some(fs) = &mut self.drives[drive as usize] {
                    let _ = fs.write_file(&filename, &data);
                }
            }
        }
    }

    /// Pop 16-bit value from stack.
    fn pop16(&mut self) -> u16 {
        let sp = self.cpu.get_sp();
        let lo = self.memory[sp as usize];
        let hi = self.memory[sp.wrapping_add(1) as usize];
        self.cpu.set_sp(sp.wrapping_add(2));
        u16::from_le_bytes([lo, hi])
    }

    /// Handle BDOS call. Returns Some(exit_info) if program should exit.
    fn handle_bdos(&mut self) -> CpmResult<Option<CpmExitInfo>> {
        let c = self.cpu.get_reg(Reg8::C, None);
        let e = self.cpu.get_reg(Reg8::E, None);
        let de = self.cpu.get_reg16(StkReg16::DE);

        if self.trace {
            eprintln!("[BDOS] Function {} (C={:#04X}, DE={:#06X})", c, c, de);
        }

        match BdosFunction::try_from(c) {
            Ok(func) => self.dispatch_bdos(func, e, de),
            Err(_) => {
                if self.trace {
                    eprintln!("[BDOS] Unknown function: {}", c);
                }
                Ok(None)
            }
        }
    }

    /// Dispatch BDOS function.
    fn dispatch_bdos(
        &mut self,
        func: BdosFunction,
        e: u8,
        de: u16,
    ) -> CpmResult<Option<CpmExitInfo>> {
        use BdosFunction::*;

        match func {
            SystemReset => {
                return Ok(Some(CpmExitInfo {
                    reason: ExitReason::WarmBoot,
                    t_states: self.clock.as_timestamp() as u64,
                    pc: self.cpu.get_pc(),
                }));
            }

            ConsoleInput => {
                let ch = self.console.wait_for_key();
                self.cpu.set_reg(Reg8::A, None, ch);
            }

            ConsoleOutput => {
                self.console.write(e);
            }

            DirectConsoleIO => {
                if e == 0xFF {
                    // Input mode
                    if let Some(ch) = self.console.get_key() {
                        self.cpu.set_reg(Reg8::A, None, ch);
                    } else {
                        self.cpu.set_reg(Reg8::A, None, 0);
                    }
                } else if e == 0xFE {
                    // Status check
                    let status = if self.console.has_key() { 0xFF } else { 0 };
                    self.cpu.set_reg(Reg8::A, None, status);
                } else if e == 0xFD {
                    // Input (wait)
                    let ch = self.console.wait_for_key();
                    self.cpu.set_reg(Reg8::A, None, ch);
                } else {
                    // Output
                    self.console.write(e);
                }
            }

            ListOutput => {
                self.console.print(e);
            }

            PrintString => {
                // Print $-terminated string at DE
                let mut addr = de;
                loop {
                    let ch = self.memory[addr as usize];
                    if ch == b'$' {
                        break;
                    }
                    self.console.write(ch);
                    addr = addr.wrapping_add(1);
                }
            }

            ReadConsoleBuffer => {
                // Read line into buffer at DE
                // Format: DE[0] = max length, DE[1] = actual length (output), DE[2..] = chars
                let max_len = self.memory[de as usize] as usize;
                let mut pos = 0;

                loop {
                    let ch = self.console.wait_for_key();

                    if ch == 13 {
                        // Enter - end input
                        self.console.write(13);
                        self.console.write(10);
                        break;
                    } else if ch == 8 || ch == 127 {
                        // Backspace
                        if pos > 0 {
                            pos -= 1;
                            self.console.write(8);
                            self.console.write(b' ');
                            self.console.write(8);
                        }
                    } else if ch >= 32 && pos < max_len {
                        // Printable character
                        self.memory[de as usize + 2 + pos] = ch;
                        pos += 1;
                        self.console.write(ch);
                    }
                }

                // Store actual length
                self.memory[de as usize + 1] = pos as u8;
            }

            ConsoleStatus => {
                let status = if self.console.has_key() { 0xFF } else { 0 };
                self.cpu.set_reg(Reg8::A, None, status);
            }

            ReturnVersion => {
                // CP/M 2.2
                self.cpu.set_reg16(StkReg16::HL, 0x0022);
            }

            ResetDiskSystem => {
                self.current_drive = 0;
                self.dma = addr::DEFAULT_DMA;
                self.cpu.set_reg(Reg8::A, None, 0);
            }

            SelectDisk => {
                self.current_drive = e;
                self.memory[0x0004] = e;
                // Return 0 if drive exists, 0xFF otherwise
                let result = if self.drives[e as usize].is_some() {
                    0
                } else {
                    0xFF
                };
                self.cpu.set_reg(Reg8::A, None, result);
            }

            ReturnCurrentDisk => {
                self.cpu.set_reg(Reg8::A, None, self.current_drive);
            }

            SetDmaAddress => {
                self.dma = de;
            }

            ReturnLoginVector => {
                // Return bitmap of available drives
                let mut vector: u16 = 0;
                for (i, drive) in self.drives.iter().enumerate() {
                    if drive.is_some() {
                        vector |= 1 << i;
                    }
                }
                self.cpu.set_reg16(StkReg16::HL, vector);
            }

            UserCode => {
                if e == 0xFF {
                    // Get user
                    self.cpu.set_reg(Reg8::A, None, self.current_user);
                } else {
                    // Set user
                    self.current_user = e & 0x0F;
                }
            }

            OpenFile => {
                self.bdos_open_file(de)?;
            }

            CloseFile => {
                self.bdos_close_file(de)?;
            }

            ReadSequential => {
                self.bdos_read_sequential(de)?;
            }

            WriteSequential => {
                self.bdos_write_sequential(de)?;
            }

            MakeFile => {
                self.bdos_make_file(de)?;
            }

            DeleteFile => {
                self.bdos_delete_file(de)?;
            }

            SearchFirst => {
                self.bdos_search_first(de)?;
            }

            SearchNext => {
                self.bdos_search_next()?;
            }

            RenameFile => {
                self.bdos_rename_file(de)?;
            }

            ReadRandom => {
                self.bdos_read_random(de)?;
            }

            WriteRandom | WriteRandomZeroFill => {
                self.bdos_write_random(de)?;
            }

            ComputeFileSize => {
                self.bdos_compute_file_size(de)?;
            }

            SetRandomRecord => {
                self.bdos_set_random_record(de)?;
            }

            // Unimplemented functions - just return success
            _ => {
                if self.trace {
                    eprintln!("[BDOS] Unimplemented: {:?}", func);
                }
                self.cpu.set_reg(Reg8::A, None, 0);
            }
        }

        Ok(None)
    }

    /// Handle CBIOS call.
    fn handle_cbios(&mut self) -> CpmResult<Option<CpmExitInfo>> {
        let pc = self.cpu.get_pc();
        let func = ((pc - addr::CBIOS) / 3) as u8;

        if self.trace {
            eprintln!("[CBIOS] Function {}", func);
        }

        match func {
            0 | 1 => {
                // BOOT/WBOOT
                return Ok(Some(CpmExitInfo {
                    reason: ExitReason::WarmBoot,
                    t_states: self.clock.as_timestamp() as u64,
                    pc,
                }));
            }
            2 => {
                // CONST - console status
                let status = if self.console.has_key() { 0xFF } else { 0 };
                self.cpu.set_reg(Reg8::A, None, status);
            }
            3 => {
                // CONIN - console input
                let ch = self.console.wait_for_key();
                self.cpu.set_reg(Reg8::A, None, ch);
            }
            4 => {
                // CONOUT - console output
                let c = self.cpu.get_reg(Reg8::C, None);
                self.console.write(c);
            }
            _ => {}
        }

        Ok(None)
    }

    // ==================== File Operations ====================

    /// Get effective drive for FCB (0 = use current).
    fn effective_drive(&self, fcb_drive: u8) -> u8 {
        if fcb_drive == 0 {
            self.current_drive
        } else {
            fcb_drive - 1
        }
    }

    /// BDOS 15: Open file.
    fn bdos_open_file(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let mut fcb = Fcb::new(&mut fcb_mem);

        let drive = self.effective_drive(fcb.drive());
        let filename = fcb.filename();

        if let Some(fs) = &self.drives[drive as usize] {
            if let Some(data) = fs.read_file(&filename) {
                // Store file in open_files
                let handle = self.open_files.len() as u32 + 1;
                self.open_files.push((drive, filename.clone(), data, false));

                // Store handle in FCB
                fcb.init();
                fcb.set_fd(handle);

                // Write FCB back
                self.memory[fcb_addr as usize..fcb_addr as usize + 36]
                    .copy_from_slice(&fcb_mem);

                self.cpu.set_reg(Reg8::A, None, 0x00);
            } else {
                self.cpu.set_reg(Reg8::A, None, 0xFF);
            }
        } else {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
        }

        Ok(())
    }

    /// BDOS 16: Close file.
    fn bdos_close_file(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let mut fcb = Fcb::new(&mut fcb_mem);

        if let Some(handle) = fcb.fd() {
            let idx = (handle - 1) as usize;
            if idx < self.open_files.len() {
                // Write back if modified
                let (drive, filename, data, modified) = &self.open_files[idx];
                if *modified {
                    if let Some(fs) = &mut self.drives[*drive as usize] {
                        let _ = fs.write_file(filename, data);
                    }
                }
            }
            fcb.clear_fd();
            self.memory[fcb_addr as usize..fcb_addr as usize + 36].copy_from_slice(&fcb_mem);
            self.cpu.set_reg(Reg8::A, None, 0x00);
        } else {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
        }

        Ok(())
    }

    /// BDOS 20: Read sequential.
    fn bdos_read_sequential(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let mut fcb = Fcb::new(&mut fcb_mem);

        let handle = fcb.fd().unwrap_or(0);
        if handle == 0 {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
            return Ok(());
        }

        let idx = (handle - 1) as usize;
        if idx >= self.open_files.len() {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
            return Ok(());
        }

        let record = fcb.current_record();
        let offset = record as usize * RECORD_SIZE;
        let data = &self.open_files[idx].2;

        if offset >= data.len() {
            // EOF
            self.cpu.set_reg(Reg8::A, None, 0x01);
        } else {
            // Clear DMA buffer
            let dma = self.dma as usize;
            for i in 0..RECORD_SIZE {
                self.memory[dma + i] = 0x1A; // CP/M EOF
            }

            // Copy data
            let end = (offset + RECORD_SIZE).min(data.len());
            let len = end - offset;
            self.memory[dma..dma + len].copy_from_slice(&data[offset..end]);

            // Advance record
            fcb.set_current_record(record + 1);
            self.memory[fcb_addr as usize..fcb_addr as usize + 36].copy_from_slice(&fcb_mem);

            self.cpu.set_reg(Reg8::A, None, 0x00);
        }

        Ok(())
    }

    /// BDOS 21: Write sequential.
    fn bdos_write_sequential(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let mut fcb = Fcb::new(&mut fcb_mem);

        let handle = fcb.fd().unwrap_or(0);
        if handle == 0 {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
            return Ok(());
        }

        let idx = (handle - 1) as usize;
        if idx >= self.open_files.len() {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
            return Ok(());
        }

        let record = fcb.current_record();
        let offset = record as usize * RECORD_SIZE;
        let dma = self.dma as usize;

        // Extend file if needed
        let data = &mut self.open_files[idx].2;
        if offset + RECORD_SIZE > data.len() {
            data.resize(offset + RECORD_SIZE, 0x1A);
        }

        // Copy from DMA
        data[offset..offset + RECORD_SIZE]
            .copy_from_slice(&self.memory[dma..dma + RECORD_SIZE]);

        self.open_files[idx].3 = true; // Mark modified

        // Advance record
        fcb.set_current_record(record + 1);
        self.memory[fcb_addr as usize..fcb_addr as usize + 36].copy_from_slice(&fcb_mem);

        self.cpu.set_reg(Reg8::A, None, 0x00);

        Ok(())
    }

    /// BDOS 22: Make (create) file.
    fn bdos_make_file(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let mut fcb = Fcb::new(&mut fcb_mem);

        let drive = self.effective_drive(fcb.drive());
        let filename = fcb.filename();

        // Create empty file in open_files
        let handle = self.open_files.len() as u32 + 1;
        self.open_files
            .push((drive, filename.clone(), Vec::new(), true));

        // Store handle in FCB
        fcb.init();
        fcb.set_fd(handle);

        // Write FCB back
        self.memory[fcb_addr as usize..fcb_addr as usize + 36].copy_from_slice(&fcb_mem);

        self.cpu.set_reg(Reg8::A, None, 0x00);

        Ok(())
    }

    /// BDOS 19: Delete file.
    fn bdos_delete_file(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let fcb = Fcb::new(&mut fcb_mem);

        let drive = self.effective_drive(fcb.drive());
        let filename = fcb.filename();

        if let Some(fs) = &mut self.drives[drive as usize] {
            if fs.delete_file(&filename) {
                self.cpu.set_reg(Reg8::A, None, 0x00);
            } else {
                self.cpu.set_reg(Reg8::A, None, 0xFF);
            }
        } else {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
        }

        Ok(())
    }

    /// BDOS 17: Search for first matching file.
    fn bdos_search_first(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let fcb = Fcb::new(&mut fcb_mem);

        let drive = self.effective_drive(fcb.drive());
        self.search_drive = drive;
        self.search_pattern_name.copy_from_slice(fcb.raw_name());
        self.search_pattern_ext.copy_from_slice(fcb.raw_ext());

        if let Some(fs) = &self.drives[drive as usize] {
            self.dir_entries = fs.list_files();
            self.dir_entries.sort();
            self.dir_index = 0;
            self.bdos_search_next()?;
        } else {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
        }

        Ok(())
    }

    /// BDOS 18: Search for next matching file.
    fn bdos_search_next(&mut self) -> CpmResult<()> {
        while self.dir_index < self.dir_entries.len() {
            let filename = &self.dir_entries[self.dir_index];
            self.dir_index += 1;

            // Parse filename into FCB format to check match
            let mut test_mem = [0u8; 36];
            let mut test_fcb = Fcb::new(&mut test_mem);
            test_fcb.parse_filename(filename);

            if test_fcb.matches_pattern(&self.search_pattern_name, &self.search_pattern_ext) {
                // Found match - write directory entry to DMA
                let dma = self.dma as usize;

                // Clear 32 bytes
                for i in 0..32 {
                    self.memory[dma + i] = 0;
                }

                // User code
                self.memory[dma] = self.current_user;

                // Filename (8 bytes)
                for (i, &b) in test_fcb.raw_name().iter().enumerate() {
                    self.memory[dma + 1 + i] = b;
                }

                // Extension (3 bytes)
                for (i, &b) in test_fcb.raw_ext().iter().enumerate() {
                    self.memory[dma + 9 + i] = b;
                }

                // Return success (directory code 0-3)
                self.cpu.set_reg(Reg8::A, None, 0x00);
                return Ok(());
            }
        }

        // No more matches
        self.cpu.set_reg(Reg8::A, None, 0xFF);
        Ok(())
    }

    /// BDOS 23: Rename file.
    fn bdos_rename_file(&mut self, fcb_addr: u16) -> CpmResult<()> {
        // FCB contains old name at offset 0, new name at offset 16
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let fcb = Fcb::new(&mut fcb_mem);

        let drive = self.effective_drive(fcb.drive());
        let old_name = fcb.filename();

        // New name is at FCB+16
        let mut new_fcb_mem = [0u8; 36];
        new_fcb_mem
            .copy_from_slice(&self.memory[fcb_addr as usize + 16..fcb_addr as usize + 16 + 36]);
        let new_fcb = Fcb::new(&mut new_fcb_mem);
        let new_name = new_fcb.filename();

        if let Some(fs) = &mut self.drives[drive as usize] {
            // Read old file
            if let Some(data) = fs.read_file(&old_name) {
                // Write to new name
                if fs.write_file(&new_name, &data).is_ok() {
                    // Delete old
                    fs.delete_file(&old_name);
                    self.cpu.set_reg(Reg8::A, None, 0x00);
                } else {
                    self.cpu.set_reg(Reg8::A, None, 0xFF);
                }
            } else {
                self.cpu.set_reg(Reg8::A, None, 0xFF);
            }
        } else {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
        }

        Ok(())
    }

    /// BDOS 33: Read random.
    fn bdos_read_random(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let fcb = Fcb::new(&mut fcb_mem);

        let handle = fcb.fd().unwrap_or(0);
        if handle == 0 {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
            return Ok(());
        }

        let idx = (handle - 1) as usize;
        if idx >= self.open_files.len() {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
            return Ok(());
        }

        let record = fcb.random_record();
        let offset = record as usize * RECORD_SIZE;
        let data = &self.open_files[idx].2;

        if offset >= data.len() {
            self.cpu.set_reg(Reg8::A, None, 0x01); // EOF
        } else {
            // Clear DMA
            let dma = self.dma as usize;
            for i in 0..RECORD_SIZE {
                self.memory[dma + i] = 0x1A;
            }

            let end = (offset + RECORD_SIZE).min(data.len());
            let len = end - offset;
            self.memory[dma..dma + len].copy_from_slice(&data[offset..end]);

            self.cpu.set_reg(Reg8::A, None, 0x00);
        }

        Ok(())
    }

    /// BDOS 34: Write random.
    fn bdos_write_random(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let fcb = Fcb::new(&mut fcb_mem);

        let handle = fcb.fd().unwrap_or(0);
        if handle == 0 {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
            return Ok(());
        }

        let idx = (handle - 1) as usize;
        if idx >= self.open_files.len() {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
            return Ok(());
        }

        let record = fcb.random_record();
        let offset = record as usize * RECORD_SIZE;
        let dma = self.dma as usize;

        let data = &mut self.open_files[idx].2;
        if offset + RECORD_SIZE > data.len() {
            data.resize(offset + RECORD_SIZE, 0x1A);
        }

        data[offset..offset + RECORD_SIZE].copy_from_slice(&self.memory[dma..dma + RECORD_SIZE]);

        self.open_files[idx].3 = true;
        self.cpu.set_reg(Reg8::A, None, 0x00);

        Ok(())
    }

    /// BDOS 35: Compute file size.
    fn bdos_compute_file_size(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let mut fcb = Fcb::new(&mut fcb_mem);

        let drive = self.effective_drive(fcb.drive());
        let filename = fcb.filename();

        if let Some(fs) = &self.drives[drive as usize] {
            if let Some(data) = fs.read_file(&filename) {
                let records = (data.len() + RECORD_SIZE - 1) / RECORD_SIZE;
                fcb.set_random_record(records as u32);
                self.memory[fcb_addr as usize..fcb_addr as usize + 36].copy_from_slice(&fcb_mem);
                self.cpu.set_reg(Reg8::A, None, 0x00);
            } else {
                self.cpu.set_reg(Reg8::A, None, 0xFF);
            }
        } else {
            self.cpu.set_reg(Reg8::A, None, 0xFF);
        }

        Ok(())
    }

    /// BDOS 36: Set random record from sequential position.
    fn bdos_set_random_record(&mut self, fcb_addr: u16) -> CpmResult<()> {
        let mut fcb_mem = [0u8; 36];
        fcb_mem.copy_from_slice(&self.memory[fcb_addr as usize..fcb_addr as usize + 36]);
        let mut fcb = Fcb::new(&mut fcb_mem);

        let record = fcb.current_record();
        fcb.set_random_record(record);

        self.memory[fcb_addr as usize..fcb_addr as usize + 36].copy_from_slice(&fcb_mem);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::console::HeadlessConsole;
    use crate::fs::MemoryDriveFS;

    #[test]
    fn test_emulator_creation() {
        let console = HeadlessConsole::new();
        let emu: CpmEmulator<HeadlessConsole, MemoryDriveFS> = CpmEmulator::new(console);

        // Check BDOS vector at 0x0005
        assert_eq!(emu.memory[0x0005], 0xC3); // JP
        assert_eq!(emu.memory[0x0006], 0x00); // Low byte of BDOS
        assert_eq!(emu.memory[0x0007], 0xFE); // High byte of BDOS
    }

    #[test]
    fn test_hello_world() {
        // Simple program: LD C,2; LD E,'H'; CALL 5; JP 0
        let program = [
            0x0E, 0x02, // LD C, 2 (console output)
            0x1E, b'H', // LD E, 'H'
            0xCD, 0x05, 0x00, // CALL 0x0005 (BDOS)
            0x1E, b'i', // LD E, 'i'
            0xCD, 0x05, 0x00, // CALL 0x0005
            0xC3, 0x00, 0x00, // JP 0x0000 (warm boot)
        ];

        let console = HeadlessConsole::new();
        let mut emu: CpmEmulator<HeadlessConsole, MemoryDriveFS> = CpmEmulator::new(console);
        emu.load_com(&program);

        let result = emu.run().unwrap();

        assert_eq!(result.reason, ExitReason::WarmBoot);
        assert_eq!(emu.console().output_string(), "Hi");
    }
}
