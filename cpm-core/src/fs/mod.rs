//! Filesystem abstractions for CP/M emulator.
//!
//! This module provides the layered filesystem architecture:
//! - `DriveFS`: Low-level drive interface (A-P)
//! - `MemoryDriveFS`: In-memory implementation
//! - `OverlayDriveFS`: Copy-on-write overlay

mod drive_fs;
mod memory_drive;
mod overlay_drive;

pub use drive_fs::{to_8_3, DriveFS};
pub use memory_drive::MemoryDriveFS;
pub use overlay_drive::OverlayDriveFS;
