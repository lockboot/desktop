//! File Control Block (FCB) implementation.
//!
//! The FCB is CP/M's file descriptor structure, stored in the program's
//! memory space and passed to BDOS functions.
//!
//! Layout (36 bytes):
//! - Byte 0: Drive (0=default, 1=A:, 2=B:, ...)
//! - Bytes 1-8: Filename (space-padded)
//! - Bytes 9-11: Extension (space-padded)
//! - Byte 12: Current extent (EX)
//! - Bytes 13-14: Reserved (S1, S2)
//! - Byte 15: Record count (RC)
//! - Bytes 16-31: Disk allocation map (d0-d15) / file descriptor storage
//! - Byte 32: Current record (CR)
//! - Bytes 33-35: Random record number (R0, R1, R2)

/// File descriptor signature for validating FCB state.
/// We XOR the file descriptor with this value to detect corruption.
const FD_SIGNATURE: u16 = 0xBEEF;

/// Size of an FCB in bytes.
pub const FCB_SIZE: usize = 36;

/// File Control Block - view into CP/M memory for file operations.
pub struct Fcb<'a> {
    mem: &'a mut [u8],
}

impl<'a> Fcb<'a> {
    /// Create FCB from memory slice (must be at least 36 bytes).
    pub fn new(memory: &'a mut [u8]) -> Self {
        debug_assert!(memory.len() >= FCB_SIZE);
        Self { mem: memory }
    }

    /// Drive number: 0 = current, 1 = A:, 2 = B:, etc.
    pub fn drive(&self) -> u8 {
        self.mem[0]
    }

    /// Set drive number.
    pub fn set_drive(&mut self, drive: u8) {
        self.mem[0] = drive;
    }

    /// Get raw filename bytes (8 chars, space-padded).
    pub fn raw_name(&self) -> &[u8] {
        &self.mem[1..9]
    }

    /// Get raw extension bytes (3 chars, space-padded).
    pub fn raw_ext(&self) -> &[u8] {
        &self.mem[9..12]
    }

    /// Get filename (8 chars, trimmed, without high bits).
    pub fn name(&self) -> String {
        self.mem[1..9]
            .iter()
            .map(|&b| (b & 0x7F) as char)
            .take_while(|&c| c != ' ')
            .collect()
    }

    /// Get extension (3 chars, trimmed, without high bits).
    pub fn extension(&self) -> String {
        self.mem[9..12]
            .iter()
            .map(|&b| (b & 0x7F) as char)
            .take_while(|&c| c != ' ')
            .collect()
    }

    /// Get full filename with extension.
    pub fn filename(&self) -> String {
        let name = self.name();
        let ext = self.extension();
        if ext.is_empty() {
            name
        } else {
            format!("{}.{}", name, ext)
        }
    }

    /// Set filename from string (will be space-padded to 8 chars).
    pub fn set_name(&mut self, name: &str) {
        let upper = name.to_uppercase();
        for (i, byte) in self.mem[1..9].iter_mut().enumerate() {
            *byte = upper.as_bytes().get(i).copied().unwrap_or(b' ');
        }
    }

    /// Set extension from string (will be space-padded to 3 chars).
    pub fn set_ext(&mut self, ext: &str) {
        let upper = ext.to_uppercase();
        for (i, byte) in self.mem[9..12].iter_mut().enumerate() {
            *byte = upper.as_bytes().get(i).copied().unwrap_or(b' ');
        }
    }

    /// Current extent number (EX).
    pub fn ex(&self) -> u8 {
        self.mem[0x0C]
    }

    /// Set current extent.
    pub fn set_ex(&mut self, v: u8) {
        self.mem[0x0C] = v;
    }

    /// S1 byte (reserved).
    pub fn s1(&self) -> u8 {
        self.mem[0x0D]
    }

    /// Set S1.
    pub fn set_s1(&mut self, v: u8) {
        self.mem[0x0D] = v;
    }

    /// S2 byte (high bits of extent for large files).
    pub fn s2(&self) -> u8 {
        self.mem[0x0E]
    }

    /// Set S2.
    pub fn set_s2(&mut self, v: u8) {
        self.mem[0x0E] = v;
    }

    /// Record count (RC) - records in current extent.
    pub fn rc(&self) -> u8 {
        self.mem[0x0F]
    }

    /// Set record count.
    pub fn set_rc(&mut self, v: u8) {
        self.mem[0x0F] = v;
    }

    /// Current record within extent (CR).
    pub fn cr(&self) -> u8 {
        self.mem[0x20]
    }

    /// Set current record.
    pub fn set_cr(&mut self, v: u8) {
        self.mem[0x20] = v;
    }

    /// Compute current record number for sequential access.
    /// Combines CR, EX, and S2 into a single record number.
    pub fn current_record(&self) -> u32 {
        (self.cr() as u32) | ((self.ex() as u32) << 7) | ((self.s2() as u32) << 12)
    }

    /// Set current record number (updates CR, EX, S2).
    pub fn set_current_record(&mut self, n: u32) {
        self.set_cr((n & 0x7F) as u8);
        self.set_ex(((n >> 7) & 0x1F) as u8);
        self.set_s2((n >> 12) as u8);
    }

    /// Random record number (24-bit, from R0, R1, R2).
    pub fn random_record(&self) -> u32 {
        (self.mem[0x21] as u32) | ((self.mem[0x22] as u32) << 8) | ((self.mem[0x23] as u32) << 16)
    }

    /// Set random record number.
    pub fn set_random_record(&mut self, n: u32) {
        self.mem[0x21] = (n & 0xFF) as u8;
        self.mem[0x22] = ((n >> 8) & 0xFF) as u8;
        self.mem[0x23] = ((n >> 16) & 0xFF) as u8;
    }

    /// Get file descriptor stored in FCB d[] bytes.
    /// We store the file handle in bytes 16-19 with a signature for validation.
    /// Returns None if no valid descriptor is stored.
    pub fn fd(&self) -> Option<u32> {
        let n1 = u16::from_le_bytes([self.mem[0x10], self.mem[0x11]]);
        let n2 = u16::from_le_bytes([self.mem[0x12], self.mem[0x13]]);

        // Validate signature
        if n1 != 0 && (n1 ^ FD_SIGNATURE) == n2 {
            Some(n1 as u32)
        } else {
            None
        }
    }

    /// Set file descriptor.
    pub fn set_fd(&mut self, n: u32) {
        let n1 = n as u16;
        let n2 = n1 ^ FD_SIGNATURE;

        self.mem[0x10] = n1 as u8;
        self.mem[0x11] = (n1 >> 8) as u8;
        self.mem[0x12] = n2 as u8;
        self.mem[0x13] = (n2 >> 8) as u8;
    }

    /// Clear file descriptor.
    pub fn clear_fd(&mut self) {
        self.mem[0x10] = 0;
        self.mem[0x11] = 0;
        self.mem[0x12] = 0;
        self.mem[0x13] = 0;
    }

    /// Initialize FCB for a new file operation.
    pub fn init(&mut self) {
        self.set_ex(0);
        self.set_s1(0);
        self.set_s2(0);
        self.set_rc(0);
        self.set_cr(0);
        self.clear_fd();
    }

    /// Check if this FCB matches a filename pattern.
    /// `?` matches any single character.
    pub fn matches_pattern(&self, pattern_name: &[u8], pattern_ext: &[u8]) -> bool {
        // Match name (8 chars)
        for i in 0..8 {
            let pattern_char = pattern_name.get(i).copied().unwrap_or(b' ') & 0x7F;
            let fcb_char = self.mem[1 + i] & 0x7F;

            if pattern_char != b'?' && pattern_char != fcb_char {
                return false;
            }
        }

        // Match extension (3 chars)
        for i in 0..3 {
            let pattern_char = pattern_ext.get(i).copied().unwrap_or(b' ') & 0x7F;
            let fcb_char = self.mem[9 + i] & 0x7F;

            if pattern_char != b'?' && pattern_char != fcb_char {
                return false;
            }
        }

        true
    }

    /// Blank out this FCB (set to spaces).
    pub fn blank(&mut self) {
        self.mem[0] = 0;
        for byte in &mut self.mem[1..12] {
            *byte = b' ';
        }
        for byte in &mut self.mem[12..FCB_SIZE] {
            *byte = 0;
        }
    }

    /// Parse a filename string into an FCB.
    /// Handles formats like "A:FILE.TXT", "FILE.TXT", "FILE"
    pub fn parse_filename(&mut self, filename: &str) {
        self.blank();

        let mut s = filename.to_uppercase();

        // Check for drive prefix
        if s.len() >= 2 && s.as_bytes()[1] == b':' {
            let drive = s.as_bytes()[0];
            if drive.is_ascii_uppercase() {
                self.set_drive(drive - b'A' + 1);
            }
            s = s[2..].to_string();
        }

        // Split name and extension
        let (name, ext) = match s.rfind('.') {
            Some(pos) => (&s[..pos], &s[pos + 1..]),
            None => (s.as_str(), ""),
        };

        self.set_name(name);
        self.set_ext(ext);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_fcb() -> [u8; FCB_SIZE] {
        [0u8; FCB_SIZE]
    }

    #[test]
    fn test_parse_filename() {
        let mut mem = make_fcb();
        let mut fcb = Fcb::new(&mut mem);

        fcb.parse_filename("TEST.TXT");
        assert_eq!(fcb.drive(), 0);
        assert_eq!(fcb.name(), "TEST");
        assert_eq!(fcb.extension(), "TXT");
        assert_eq!(fcb.filename(), "TEST.TXT");
    }

    #[test]
    fn test_parse_filename_with_drive() {
        let mut mem = make_fcb();
        let mut fcb = Fcb::new(&mut mem);

        fcb.parse_filename("B:HELLO.COM");
        assert_eq!(fcb.drive(), 2); // B = 2
        assert_eq!(fcb.name(), "HELLO");
        assert_eq!(fcb.extension(), "COM");
    }

    #[test]
    fn test_current_record() {
        let mut mem = make_fcb();
        let mut fcb = Fcb::new(&mut mem);

        fcb.set_current_record(0);
        assert_eq!(fcb.current_record(), 0);

        fcb.set_current_record(127);
        assert_eq!(fcb.current_record(), 127);
        assert_eq!(fcb.cr(), 127);
        assert_eq!(fcb.ex(), 0);

        fcb.set_current_record(128);
        assert_eq!(fcb.current_record(), 128);
        assert_eq!(fcb.cr(), 0);
        assert_eq!(fcb.ex(), 1);

        fcb.set_current_record(1000);
        assert_eq!(fcb.current_record(), 1000);
    }

    #[test]
    fn test_fd_storage() {
        let mut mem = make_fcb();
        let mut fcb = Fcb::new(&mut mem);

        assert_eq!(fcb.fd(), None);

        fcb.set_fd(42);
        assert_eq!(fcb.fd(), Some(42));

        fcb.set_fd(12345);
        assert_eq!(fcb.fd(), Some(12345));

        fcb.clear_fd();
        assert_eq!(fcb.fd(), None);
    }

    #[test]
    fn test_matches_pattern() {
        let mut mem = make_fcb();
        let mut fcb = Fcb::new(&mut mem);
        fcb.parse_filename("TEST.TXT");

        // Exact match
        assert!(fcb.matches_pattern(b"TEST    ", b"TXT"));

        // Wildcard match
        assert!(fcb.matches_pattern(b"T???????", b"???"));

        // No match
        assert!(!fcb.matches_pattern(b"OTHER   ", b"TXT"));
    }
}
