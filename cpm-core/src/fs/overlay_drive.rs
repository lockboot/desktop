//! Copy-on-write overlay filesystem.

use std::collections::{HashMap, HashSet};

use super::drive_fs::{to_8_3, DriveFS};
use crate::error::CpmResult;

/// Copy-on-write overlay on top of a base filesystem.
///
/// - Reads come from overlay first, then fall back to base
/// - Writes go to overlay only (base is never modified)
/// - Deletes mark files as deleted without affecting base
pub struct OverlayDriveFS<B: DriveFS> {
    base: B,
    overlay: HashMap<String, Vec<u8>>,
    deleted: HashSet<String>,
}

impl<B: DriveFS> OverlayDriveFS<B> {
    pub fn new(base: B) -> Self {
        Self {
            base,
            overlay: HashMap::new(),
            deleted: HashSet::new(),
        }
    }

    /// Get the underlying base filesystem.
    pub fn base(&self) -> &B {
        &self.base
    }

    /// Get mutable reference to base filesystem.
    pub fn base_mut(&mut self) -> &mut B {
        &mut self.base
    }

    /// Get files that have been modified/added in the overlay.
    pub fn modified_files(&self) -> &HashMap<String, Vec<u8>> {
        &self.overlay
    }

    /// Get list of deleted files.
    pub fn deleted_files(&self) -> impl Iterator<Item = &str> {
        self.deleted.iter().map(|s| s.as_str())
    }

    /// Check if a file was modified (exists in overlay).
    pub fn is_modified(&self, name: &str) -> bool {
        self.overlay.contains_key(&to_8_3(name))
    }

    /// Check if a file was deleted.
    pub fn is_deleted(&self, name: &str) -> bool {
        self.deleted.contains(&to_8_3(name))
    }

    /// Clear all overlay modifications.
    pub fn clear_overlay(&mut self) {
        self.overlay.clear();
        self.deleted.clear();
    }
}

impl<B: DriveFS> DriveFS for OverlayDriveFS<B> {
    fn read_file(&self, name: &str) -> Option<Vec<u8>> {
        let normalized = to_8_3(name);

        // Check if deleted
        if self.deleted.contains(&normalized) {
            return None;
        }

        // Check overlay first, then base
        self.overlay
            .get(&normalized)
            .cloned()
            .or_else(|| self.base.read_file(name))
    }

    fn write_file(&mut self, name: &str, data: &[u8]) -> CpmResult<()> {
        let normalized = to_8_3(name);
        self.overlay.insert(normalized.clone(), data.to_vec());
        self.deleted.remove(&normalized);
        Ok(())
    }

    fn delete_file(&mut self, name: &str) -> bool {
        let normalized = to_8_3(name);
        let existed = self.exists(name);

        self.overlay.remove(&normalized);
        self.deleted.insert(normalized);

        existed
    }

    fn list_files(&self) -> Vec<String> {
        let mut files: HashSet<String> = self.base.list_files().into_iter().collect();

        // Add overlay files
        for name in self.overlay.keys() {
            files.insert(name.clone());
        }

        // Remove deleted files
        for name in &self.deleted {
            files.remove(name);
        }

        files.into_iter().collect()
    }

    fn exists(&self, name: &str) -> bool {
        let normalized = to_8_3(name);

        if self.deleted.contains(&normalized) {
            return false;
        }

        self.overlay.contains_key(&normalized) || self.base.exists(name)
    }
}

#[cfg(test)]
mod tests {
    use super::super::MemoryDriveFS;
    use super::*;

    #[test]
    fn test_read_from_base() {
        let mut base = MemoryDriveFS::new();
        base.add_file("BASE.TXT", b"base content".to_vec());

        let overlay = OverlayDriveFS::new(base);

        assert!(overlay.exists("BASE.TXT"));
        assert_eq!(
            overlay.read_file("BASE.TXT"),
            Some(b"base content".to_vec())
        );
    }

    #[test]
    fn test_write_to_overlay() {
        let base = MemoryDriveFS::new();
        let mut overlay = OverlayDriveFS::new(base);

        overlay.write_file("NEW.TXT", b"new content").unwrap();

        assert!(overlay.exists("NEW.TXT"));
        assert_eq!(overlay.read_file("NEW.TXT"), Some(b"new content".to_vec()));
        assert!(!overlay.base().exists("NEW.TXT")); // Base unchanged
    }

    #[test]
    fn test_override_base_file() {
        let mut base = MemoryDriveFS::new();
        base.add_file("FILE.TXT", b"original".to_vec());

        let mut overlay = OverlayDriveFS::new(base);
        overlay.write_file("FILE.TXT", b"modified").unwrap();

        assert_eq!(overlay.read_file("FILE.TXT"), Some(b"modified".to_vec()));
        assert_eq!(
            overlay.base().read_file("FILE.TXT"),
            Some(b"original".to_vec())
        );
    }

    #[test]
    fn test_delete_base_file() {
        let mut base = MemoryDriveFS::new();
        base.add_file("FILE.TXT", b"content".to_vec());

        let mut overlay = OverlayDriveFS::new(base);
        assert!(overlay.delete_file("FILE.TXT"));

        assert!(!overlay.exists("FILE.TXT"));
        assert!(overlay.is_deleted("FILE.TXT"));
        assert!(overlay.base().exists("FILE.TXT")); // Base unchanged
    }

    #[test]
    fn test_undelete_by_write() {
        let mut base = MemoryDriveFS::new();
        base.add_file("FILE.TXT", b"original".to_vec());

        let mut overlay = OverlayDriveFS::new(base);
        overlay.delete_file("FILE.TXT");
        assert!(!overlay.exists("FILE.TXT"));

        overlay.write_file("FILE.TXT", b"restored").unwrap();
        assert!(overlay.exists("FILE.TXT"));
        assert!(!overlay.is_deleted("FILE.TXT"));
    }

    #[test]
    fn test_list_files() {
        let mut base = MemoryDriveFS::new();
        base.add_file("A.TXT", vec![1]);
        base.add_file("B.TXT", vec![2]);

        let mut overlay = OverlayDriveFS::new(base);
        overlay.write_file("C.TXT", &[3]).unwrap();
        overlay.delete_file("A.TXT");

        let files = overlay.list_files();
        assert!(!files.contains(&"A.TXT".to_string())); // Deleted
        assert!(files.contains(&"B.TXT".to_string())); // From base
        assert!(files.contains(&"C.TXT".to_string())); // From overlay
    }
}
