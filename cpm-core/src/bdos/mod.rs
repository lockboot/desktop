//! BDOS (Basic Disk Operating System) implementation.
//!
//! This module handles CP/M 2.2 system calls.

pub mod fcb;

pub use fcb::Fcb;

/// CP/M 2.2 BDOS function numbers.
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum BdosFunction {
    /// 0: System reset / warm boot
    SystemReset = 0,
    /// 1: Console input (blocking)
    ConsoleInput = 1,
    /// 2: Console output
    ConsoleOutput = 2,
    /// 3: Reader input
    ReaderInput = 3,
    /// 4: Punch output
    PunchOutput = 4,
    /// 5: List output
    ListOutput = 5,
    /// 6: Direct console I/O
    DirectConsoleIO = 6,
    /// 7: Get IOBYTE
    GetIOByte = 7,
    /// 8: Set IOBYTE
    SetIOByte = 8,
    /// 9: Print string ($ terminated)
    PrintString = 9,
    /// 10: Read console buffer
    ReadConsoleBuffer = 10,
    /// 11: Get console status
    ConsoleStatus = 11,
    /// 12: Return version number
    ReturnVersion = 12,
    /// 13: Reset disk system
    ResetDiskSystem = 13,
    /// 14: Select disk
    SelectDisk = 14,
    /// 15: Open file
    OpenFile = 15,
    /// 16: Close file
    CloseFile = 16,
    /// 17: Search for first
    SearchFirst = 17,
    /// 18: Search for next
    SearchNext = 18,
    /// 19: Delete file
    DeleteFile = 19,
    /// 20: Read sequential
    ReadSequential = 20,
    /// 21: Write sequential
    WriteSequential = 21,
    /// 22: Make file (create)
    MakeFile = 22,
    /// 23: Rename file
    RenameFile = 23,
    /// 24: Return login vector
    ReturnLoginVector = 24,
    /// 25: Return current disk
    ReturnCurrentDisk = 25,
    /// 26: Set DMA address
    SetDmaAddress = 26,
    /// 27: Get allocation vector
    GetAllocationVector = 27,
    /// 28: Write protect disk
    WriteProtectDisk = 28,
    /// 29: Get R/O vector
    GetReadOnlyVector = 29,
    /// 30: Set file attributes
    SetFileAttributes = 30,
    /// 31: Get disk parameters
    GetDiskParameters = 31,
    /// 32: Get/set user code
    UserCode = 32,
    /// 33: Read random
    ReadRandom = 33,
    /// 34: Write random
    WriteRandom = 34,
    /// 35: Compute file size
    ComputeFileSize = 35,
    /// 36: Set random record
    SetRandomRecord = 36,
    /// 37: Reset drive
    ResetDrive = 37,
    /// 40: Write random with zero fill
    WriteRandomZeroFill = 40,
}

impl TryFrom<u8> for BdosFunction {
    type Error = u8;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::SystemReset),
            1 => Ok(Self::ConsoleInput),
            2 => Ok(Self::ConsoleOutput),
            3 => Ok(Self::ReaderInput),
            4 => Ok(Self::PunchOutput),
            5 => Ok(Self::ListOutput),
            6 => Ok(Self::DirectConsoleIO),
            7 => Ok(Self::GetIOByte),
            8 => Ok(Self::SetIOByte),
            9 => Ok(Self::PrintString),
            10 => Ok(Self::ReadConsoleBuffer),
            11 => Ok(Self::ConsoleStatus),
            12 => Ok(Self::ReturnVersion),
            13 => Ok(Self::ResetDiskSystem),
            14 => Ok(Self::SelectDisk),
            15 => Ok(Self::OpenFile),
            16 => Ok(Self::CloseFile),
            17 => Ok(Self::SearchFirst),
            18 => Ok(Self::SearchNext),
            19 => Ok(Self::DeleteFile),
            20 => Ok(Self::ReadSequential),
            21 => Ok(Self::WriteSequential),
            22 => Ok(Self::MakeFile),
            23 => Ok(Self::RenameFile),
            24 => Ok(Self::ReturnLoginVector),
            25 => Ok(Self::ReturnCurrentDisk),
            26 => Ok(Self::SetDmaAddress),
            27 => Ok(Self::GetAllocationVector),
            28 => Ok(Self::WriteProtectDisk),
            29 => Ok(Self::GetReadOnlyVector),
            30 => Ok(Self::SetFileAttributes),
            31 => Ok(Self::GetDiskParameters),
            32 => Ok(Self::UserCode),
            33 => Ok(Self::ReadRandom),
            34 => Ok(Self::WriteRandom),
            35 => Ok(Self::ComputeFileSize),
            36 => Ok(Self::SetRandomRecord),
            37 => Ok(Self::ResetDrive),
            40 => Ok(Self::WriteRandomZeroFill),
            _ => Err(value),
        }
    }
}

/// Record size in CP/M (always 128 bytes).
pub const RECORD_SIZE: usize = 128;

/// Memory addresses for CP/M system.
pub mod addr {
    /// Transient Program Area - where .COM files load
    pub const TPA: u16 = 0x0100;
    /// Console Command Processor area
    pub const CCP: u16 = 0xDC00;
    /// BDOS entry point
    pub const BDOS: u16 = 0xFE00;
    /// CBIOS entry points
    pub const CBIOS: u16 = 0xFF00;
    /// Default DMA buffer
    pub const DEFAULT_DMA: u16 = 0x0080;
    /// File Control Block 1
    pub const FCB1: u16 = 0x005C;
    /// File Control Block 2
    pub const FCB2: u16 = 0x006C;
    /// Command line tail
    pub const CMDLINE: u16 = 0x0080;
}
