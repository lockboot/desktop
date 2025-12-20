//! CP/M 2.2 BDOS Emulator Core
//!
//! This crate provides the core components for emulating CP/M 2.2:
//! - BDOS (Basic Disk Operating System) syscall handling
//! - Virtual filesystem with overlay support
//! - Console I/O abstraction
//!
//! # Architecture
//!
//! The emulator uses a layered design:
//! - `DriveFS` trait: Low-level drive filesystem (A-P)
//! - `VirtualFS` trait: Higher-level path-based filesystem
//! - `CpmConsole` trait: Character I/O abstraction
//! - `CpmEmulator`: Integrates Z80 CPU with BDOS handling

pub mod bdos;
pub mod console;
pub mod emulator;
pub mod error;
pub mod fs;
pub mod package;

pub use console::{CpmConsole, HeadlessConsole};
pub use emulator::CpmEmulator;
pub use error::{CpmError, CpmResult};
pub use fs::{to_8_3, DriveFS, MemoryDriveFS, OverlayDriveFS};
pub use package::{
    load_package, load_package_from_path, load_packages, LoadedPackage, PackageAction,
    PackageDriveFS, PackageManifest,
};

/// Reason for program exit.
#[derive(Debug, Clone, PartialEq)]
pub enum ExitReason {
    /// Warm boot (JP 0 or BDOS function 0)
    WarmBoot,
    /// CPU halted
    Halt,
    /// Error occurred
    Error(String),
}

/// Information about program exit.
#[derive(Debug, Clone)]
pub struct CpmExitInfo {
    pub reason: ExitReason,
    pub t_states: u64,
    pub pc: u16,
}
