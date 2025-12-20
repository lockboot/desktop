//! DriveFS trait - low-level filesystem interface for CP/M drives.

use crate::error::CpmResult;

/// Filesystem interface for a single CP/M drive (A-P).
/// All filenames are normalized to CP/M 8.3 format.
pub trait DriveFS: Send + Sync {
    /// Read file content. Returns None if file does not exist.
    fn read_file(&self, name: &str) -> Option<Vec<u8>>;

    /// Write file content.
    fn write_file(&mut self, name: &str, data: &[u8]) -> CpmResult<()>;

    /// Delete a file. Returns true if file existed and was deleted.
    fn delete_file(&mut self, name: &str) -> bool;

    /// List all files on this drive.
    fn list_files(&self) -> Vec<String>;

    /// Check if file exists.
    fn exists(&self, name: &str) -> bool;
}

/// Convert filename to CP/M 8.3 format.
///
/// - Uppercases everything
/// - Truncates name to 8 chars, extension to 3 chars
/// - Removes invalid characters
///
/// # Examples
/// ```
/// use cpm_core::to_8_3;
/// assert_eq!(to_8_3("hello.txt"), "HELLO.TXT");
/// assert_eq!(to_8_3("VeryLongName.extension"), "VERYLONG.EXT");
/// assert_eq!(to_8_3("noext"), "NOEXT");
/// ```
pub fn to_8_3(filename: &str) -> String {
    let upper = filename.to_uppercase();
    let (name, ext) = match upper.rfind('.') {
        Some(pos) => (&upper[..pos], &upper[pos + 1..]),
        None => (upper.as_str(), ""),
    };

    // Valid CP/M characters: A-Z, 0-9, $ # @ ! % ' ` ( ) { } ~ ^ - _
    fn clean(s: &str) -> String {
        s.chars()
            .filter(|c| c.is_ascii_alphanumeric() || "$#@!%'`(){}~^-_".contains(*c))
            .collect()
    }

    let clean_name: String = clean(name).chars().take(8).collect();
    let clean_ext: String = clean(ext).chars().take(3).collect();

    // Name must be at least 1 char
    let final_name = if clean_name.is_empty() {
        "_".to_string()
    } else {
        clean_name
    };

    if clean_ext.is_empty() {
        final_name
    } else {
        format!("{}.{}", final_name, clean_ext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_8_3_basic() {
        assert_eq!(to_8_3("hello.txt"), "HELLO.TXT");
        assert_eq!(to_8_3("HELLO.TXT"), "HELLO.TXT");
    }

    #[test]
    fn test_to_8_3_truncation() {
        assert_eq!(to_8_3("verylongname.extension"), "VERYLONG.EXT");
    }

    #[test]
    fn test_to_8_3_no_extension() {
        assert_eq!(to_8_3("noext"), "NOEXT");
    }

    #[test]
    fn test_to_8_3_special_chars() {
        assert_eq!(to_8_3("test$file.com"), "TEST$FIL.COM");
        assert_eq!(to_8_3("hello world.txt"), "HELLOWOR.TXT"); // space removed, truncated to 8
    }

    #[test]
    fn test_to_8_3_empty_name() {
        assert_eq!(to_8_3(".txt"), "_.TXT");
    }
}
