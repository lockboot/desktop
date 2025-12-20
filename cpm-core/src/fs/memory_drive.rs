//! In-memory filesystem implementation.

use std::collections::HashMap;

use super::drive_fs::{to_8_3, DriveFS};
use crate::error::CpmResult;

/// Simple in-memory filesystem for a drive.
#[derive(Default, Clone)]
pub struct MemoryDriveFS {
    files: HashMap<String, Vec<u8>>,
}

impl MemoryDriveFS {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create with initial files.
    pub fn with_files<I, S>(files: I) -> Self
    where
        I: IntoIterator<Item = (S, Vec<u8>)>,
        S: AsRef<str>,
    {
        let files = files
            .into_iter()
            .map(|(k, v)| (to_8_3(k.as_ref()), v))
            .collect();
        Self { files }
    }

    /// Add a file (convenience method).
    pub fn add_file(&mut self, name: &str, data: impl Into<Vec<u8>>) {
        self.files.insert(to_8_3(name), data.into());
    }

    /// Add a file from string content.
    pub fn add_file_str(&mut self, name: &str, content: &str) {
        self.add_file(name, content.as_bytes().to_vec());
    }
}

impl DriveFS for MemoryDriveFS {
    fn read_file(&self, name: &str) -> Option<Vec<u8>> {
        self.files.get(&to_8_3(name)).cloned()
    }

    fn write_file(&mut self, name: &str, data: &[u8]) -> CpmResult<()> {
        self.files.insert(to_8_3(name), data.to_vec());
        Ok(())
    }

    fn delete_file(&mut self, name: &str) -> bool {
        self.files.remove(&to_8_3(name)).is_some()
    }

    fn list_files(&self) -> Vec<String> {
        self.files.keys().cloned().collect()
    }

    fn exists(&self, name: &str) -> bool {
        self.files.contains_key(&to_8_3(name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_read_file() {
        let mut fs = MemoryDriveFS::new();
        fs.write_file("TEST.COM", &[0xC9]).unwrap();

        assert!(fs.exists("TEST.COM"));
        assert!(fs.exists("test.com")); // Case insensitive
        assert_eq!(fs.read_file("TEST.COM"), Some(vec![0xC9]));
    }

    #[test]
    fn test_delete_file() {
        let mut fs = MemoryDriveFS::new();
        fs.write_file("TEST.COM", &[0xC9]).unwrap();

        assert!(fs.delete_file("TEST.COM"));
        assert!(!fs.exists("TEST.COM"));
        assert!(!fs.delete_file("NOTEXIST.COM"));
    }

    #[test]
    fn test_list_files() {
        let mut fs = MemoryDriveFS::new();
        fs.add_file("A.COM", vec![1]);
        fs.add_file("B.TXT", vec![2]);

        let files = fs.list_files();
        assert_eq!(files.len(), 2);
        assert!(files.contains(&"A.COM".to_string()));
        assert!(files.contains(&"B.TXT".to_string()));
    }

    #[test]
    fn test_with_files() {
        let fs =
            MemoryDriveFS::with_files([("test.com", vec![0xC9]), ("hello.txt", b"Hello".to_vec())]);

        assert!(fs.exists("TEST.COM"));
        assert!(fs.exists("HELLO.TXT"));
    }
}
