//! CP/M Workspace - Shared environment for multiple terminals.
//!
//! A Workspace provides:
//! - Drive mappings (A-P) backed by DriveFS implementations
//! - Shared state across multiple emulator instances
//! - File change notifications
//!
//! Multiple terminals can attach to the same workspace and see changes instantly.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::error::{CpmError, CpmResult};
use crate::fs::{DriveFS, MemoryDriveFS, OverlayDriveFS};
use crate::package::{LoadedPackage, PackageDriveFS};

/// Drive configuration.
#[derive(Debug, Clone)]
pub struct DriveConfig {
    /// Drive letter (A-P)
    pub letter: char,
    /// Package names loaded on this drive
    pub packages: Vec<String>,
    /// Whether the drive has a writable overlay layer
    pub writable: bool,
}

/// Shell information found in a workspace.
#[derive(Debug, Clone)]
pub struct ShellInfo {
    /// Shell binary data
    pub binary: Vec<u8>,
    /// Shell filename (e.g., "CCP.COM")
    pub filename: String,
    /// Drive letter where shell was found
    pub drive: char,
    /// Load address (default 0x100 for TPA, or custom like 0xDC00)
    pub load_address: u16,
    /// Package name that provided the shell
    pub package_name: String,
}

/// File change event.
#[derive(Debug, Clone)]
pub enum FileChangeEvent {
    Write { drive: char, filename: String },
    Delete { drive: char, filename: String },
    Rename { drive: char, old_name: String, new_name: String },
}

/// Shared workspace state (interior of Arc<RwLock<...>>).
struct WorkspaceInner {
    /// Drive filesystems (A=0, B=1, ..., P=15)
    drives: [Option<Box<dyn DriveFS>>; 16],
    /// Drive configurations
    configs: HashMap<char, DriveConfig>,
    /// Loaded packages cache
    package_cache: HashMap<String, LoadedPackage>,
}

impl Default for WorkspaceInner {
    fn default() -> Self {
        Self {
            drives: Default::default(),
            configs: HashMap::new(),
            package_cache: HashMap::new(),
        }
    }
}

/// CP/M Workspace - shared environment for multiple terminals.
///
/// Workspaces are thread-safe and can be shared across multiple emulator instances.
/// Clone is cheap (just clones the Arc).
#[derive(Clone)]
pub struct Workspace {
    inner: Arc<RwLock<WorkspaceInner>>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self::new()
    }
}

impl Workspace {
    /// Create a new empty workspace.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(WorkspaceInner::default())),
        }
    }

    /// Mount a filesystem to a drive letter (A-P).
    pub fn mount(&self, letter: char, fs: Box<dyn DriveFS>) -> CpmResult<()> {
        let idx = drive_index(letter)?;
        let mut inner = self.inner.write().map_err(|_| CpmError::LockPoisoned)?;
        inner.drives[idx] = Some(fs);
        Ok(())
    }

    /// Unmount a drive.
    pub fn unmount(&self, letter: char) -> CpmResult<()> {
        let idx = drive_index(letter)?;
        let mut inner = self.inner.write().map_err(|_| CpmError::LockPoisoned)?;
        inner.drives[idx] = None;
        inner.configs.remove(&letter.to_ascii_uppercase());
        Ok(())
    }

    /// Check if a drive is mounted.
    pub fn is_mounted(&self, letter: char) -> bool {
        if let Ok(idx) = drive_index(letter) {
            if let Ok(inner) = self.inner.read() {
                return inner.drives[idx].is_some();
            }
        }
        false
    }

    /// Read a file from a drive.
    pub fn read_file(&self, letter: char, name: &str) -> Option<Vec<u8>> {
        let idx = drive_index(letter).ok()?;
        let inner = self.inner.read().ok()?;
        inner.drives[idx].as_ref()?.read_file(name)
    }

    /// Write a file to a drive.
    pub fn write_file(&self, letter: char, name: &str, data: &[u8]) -> CpmResult<()> {
        let idx = drive_index(letter)?;
        let mut inner = self.inner.write().map_err(|_| CpmError::LockPoisoned)?;
        if let Some(ref mut fs) = inner.drives[idx] {
            fs.write_file(name, data)
        } else {
            Err(CpmError::DriveNotMounted(letter))
        }
    }

    /// Delete a file from a drive.
    pub fn delete_file(&self, letter: char, name: &str) -> CpmResult<bool> {
        let idx = drive_index(letter)?;
        let mut inner = self.inner.write().map_err(|_| CpmError::LockPoisoned)?;
        if let Some(ref mut fs) = inner.drives[idx] {
            Ok(fs.delete_file(name))
        } else {
            Err(CpmError::DriveNotMounted(letter))
        }
    }

    /// List files on a drive.
    pub fn list_files(&self, letter: char) -> CpmResult<Vec<String>> {
        let idx = drive_index(letter)?;
        let inner = self.inner.read().map_err(|_| CpmError::LockPoisoned)?;
        if let Some(ref fs) = inner.drives[idx] {
            Ok(fs.list_files())
        } else {
            Err(CpmError::DriveNotMounted(letter))
        }
    }

    /// Check if a file exists on a drive.
    pub fn file_exists(&self, letter: char, name: &str) -> bool {
        if let Ok(idx) = drive_index(letter) {
            if let Ok(inner) = self.inner.read() {
                if let Some(ref fs) = inner.drives[idx] {
                    return fs.exists(name);
                }
            }
        }
        false
    }

    /// Get list of mounted drives.
    pub fn mounted_drives(&self) -> Vec<char> {
        let inner = match self.inner.read() {
            Ok(inner) => inner,
            Err(_) => return vec![],
        };
        inner
            .drives
            .iter()
            .enumerate()
            .filter_map(|(i, d)| {
                if d.is_some() {
                    Some((b'A' + i as u8) as char)
                } else {
                    None
                }
            })
            .collect()
    }

    /// Configure a drive with packages.
    pub fn configure_drive(&self, config: DriveConfig, packages: Vec<LoadedPackage>) -> CpmResult<()> {
        let letter = config.letter.to_ascii_uppercase();
        let idx = drive_index(letter)?;

        // Create PackageDriveFS from packages
        let base_fs = PackageDriveFS::from_packages(packages);

        // Wrap in OverlayDriveFS if writable
        let fs: Box<dyn DriveFS> = if config.writable {
            Box::new(OverlayDriveFS::new(base_fs))
        } else {
            Box::new(base_fs)
        };

        let mut inner = self.inner.write().map_err(|_| CpmError::LockPoisoned)?;
        inner.drives[idx] = Some(fs);
        inner.configs.insert(letter, config);
        Ok(())
    }

    /// Get drive configuration.
    pub fn get_drive_config(&self, letter: char) -> Option<DriveConfig> {
        let inner = self.inner.read().ok()?;
        inner.configs.get(&letter.to_ascii_uppercase()).cloned()
    }

    /// Cache a loaded package.
    pub fn cache_package(&self, name: &str, pkg: LoadedPackage) {
        if let Ok(mut inner) = self.inner.write() {
            inner.package_cache.insert(name.to_lowercase(), pkg);
        }
    }

    /// Get a cached package.
    pub fn get_cached_package(&self, name: &str) -> Option<LoadedPackage> {
        let inner = self.inner.read().ok()?;
        inner.package_cache.get(&name.to_lowercase()).cloned()
    }

    /// Find a shell from mounted packages.
    ///
    /// Searches all drives for packages with shell metadata:
    /// - File entry with type: "shell" and optional loadAddress
    pub fn find_shell(&self) -> Option<ShellInfo> {
        let inner = self.inner.read().ok()?;

        for (i, drive_opt) in inner.drives.iter().enumerate() {
            let Some(drive) = drive_opt else { continue };
            let letter = (b'A' + i as u8) as char;

            // Try to get packages from the drive
            // This is a bit awkward since we need to downcast
            // For now, check the drive config for package names
            if let Some(config) = inner.configs.get(&letter) {
                for pkg_name in &config.packages {
                    if let Some(pkg) = inner.package_cache.get(&pkg_name.to_lowercase()) {
                        // Check for shell in manifest
                        for file_entry in &pkg.manifest.files {
                            if file_entry.file_type.as_deref() == Some("shell") {
                                let filename = crate::fs::to_8_3(&file_entry.src);
                                if let Some(data) = pkg.files.get(&filename) {
                                    let load_address = file_entry
                                        .load_address
                                        .as_ref()
                                        .and_then(|s| {
                                            let s = s.trim_start_matches("0x").trim_start_matches("0X");
                                            u16::from_str_radix(s, 16).ok()
                                        })
                                        .unwrap_or(0x0100);

                                    return Some(ShellInfo {
                                        binary: data.clone(),
                                        filename,
                                        drive: letter,
                                        load_address,
                                        package_name: pkg.manifest.name.clone(),
                                    });
                                }
                            }
                        }
                    }
                }
            }

            // Fallback: look for known shell names
            let shell_names = ["XCCP.COM", "CCP.COM", "ZCCP.COM"];
            for name in shell_names {
                if let Some(data) = drive.read_file(name) {
                    return Some(ShellInfo {
                        binary: data,
                        filename: name.to_string(),
                        drive: letter,
                        load_address: 0x0100,
                        package_name: "unknown".to_string(),
                    });
                }
            }
        }

        None
    }

    /// Create a simple writable drive with an empty MemoryDriveFS.
    pub fn create_memory_drive(&self, letter: char) -> CpmResult<()> {
        let idx = drive_index(letter)?;
        let fs = Box::new(MemoryDriveFS::new());
        let mut inner = self.inner.write().map_err(|_| CpmError::LockPoisoned)?;
        inner.drives[idx] = Some(fs);
        Ok(())
    }
}

/// Convert drive letter to index (A=0, B=1, ..., P=15).
fn drive_index(letter: char) -> CpmResult<usize> {
    let upper = letter.to_ascii_uppercase();
    if upper >= 'A' && upper <= 'P' {
        Ok((upper as u8 - b'A') as usize)
    } else {
        Err(CpmError::InvalidDrive(letter))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workspace_mount_unmount() {
        let ws = Workspace::new();

        // Mount A:
        ws.create_memory_drive('A').unwrap();
        assert!(ws.is_mounted('A'));
        assert!(!ws.is_mounted('B'));

        // Write and read
        ws.write_file('A', "TEST.TXT", b"Hello").unwrap();
        let data = ws.read_file('A', "TEST.TXT").unwrap();
        assert_eq!(data, b"Hello");

        // Unmount
        ws.unmount('A').unwrap();
        assert!(!ws.is_mounted('A'));
    }

    #[test]
    fn test_workspace_shared() {
        let ws1 = Workspace::new();
        let ws2 = ws1.clone(); // Cheap clone (Arc)

        ws1.create_memory_drive('A').unwrap();
        ws1.write_file('A', "TEST.TXT", b"Hello from ws1").unwrap();

        // ws2 sees the same data
        let data = ws2.read_file('A', "TEST.TXT").unwrap();
        assert_eq!(data, b"Hello from ws1");

        // ws2 writes, ws1 sees it
        ws2.write_file('A', "TEST.TXT", b"Modified by ws2").unwrap();
        let data = ws1.read_file('A', "TEST.TXT").unwrap();
        assert_eq!(data, b"Modified by ws2");
    }

    #[test]
    fn test_drive_index() {
        assert_eq!(drive_index('A').unwrap(), 0);
        assert_eq!(drive_index('a').unwrap(), 0);
        assert_eq!(drive_index('P').unwrap(), 15);
        assert!(drive_index('Q').is_err());
        assert!(drive_index('Z').is_err());
    }
}
