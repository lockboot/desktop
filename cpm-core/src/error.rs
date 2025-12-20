//! Error types for CP/M emulator.

use thiserror::Error;

/// Errors that can occur during CP/M emulation.
#[derive(Error, Debug)]
pub enum CpmError {
    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Invalid file handle: {0}")]
    InvalidHandle(u32),

    #[error("Read-only filesystem")]
    ReadOnly,

    #[error("Invalid FCB")]
    InvalidFcb,

    #[error("End of file")]
    Eof,

    #[error("Invalid drive: {0}")]
    InvalidDrive(char),

    #[error("Drive not mounted: {0}")]
    DriveNotMounted(char),

    #[error("Lock poisoned")]
    LockPoisoned,

    #[error("Disk full")]
    DiskFull,

    #[error("File exists")]
    FileExists,

    #[error("Package error: {0}")]
    Package(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Result type for CP/M operations.
pub type CpmResult<T> = Result<T, CpmError>;
