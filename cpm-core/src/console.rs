//! Console I/O abstraction for CP/M emulator.
//!
//! The `CpmConsole` trait provides character I/O that works identically
//! for both testing (HeadlessConsole) and real terminals.

use std::collections::VecDeque;

/// Console interface for CP/M character I/O.
pub trait CpmConsole: Send {
    /// Write a character to console output.
    fn write(&mut self, ch: u8);

    /// Write to printer (optional, can be no-op).
    fn print(&mut self, _ch: u8) {}

    /// Check if a key is available (non-blocking).
    fn has_key(&self) -> bool;

    /// Get next key from buffer. Returns None if no key available.
    fn get_key(&mut self) -> Option<u8>;

    /// Wait for a key (blocking). Default implementation polls.
    fn wait_for_key(&mut self) -> u8 {
        loop {
            if let Some(key) = self.get_key() {
                return key;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }
}

/// Headless console for testing - captures output, provides queued input.
#[derive(Default)]
pub struct HeadlessConsole {
    output: Vec<u8>,
    input: VecDeque<u8>,
}

impl HeadlessConsole {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create with pre-queued input.
    pub fn with_input(input: &[u8]) -> Self {
        Self {
            output: Vec::new(),
            input: input.iter().copied().collect(),
        }
    }

    /// Queue input characters.
    pub fn queue_input(&mut self, input: &[u8]) {
        self.input.extend(input.iter().copied());
    }

    /// Queue a string as input (converts to bytes).
    pub fn queue_string(&mut self, s: &str) {
        self.queue_input(s.as_bytes());
    }

    /// Get all output as bytes.
    pub fn output(&self) -> &[u8] {
        &self.output
    }

    /// Get output as string (lossy UTF-8 conversion).
    pub fn output_string(&self) -> String {
        String::from_utf8_lossy(&self.output).into_owned()
    }

    /// Clear output buffer.
    pub fn clear_output(&mut self) {
        self.output.clear();
    }
}

impl CpmConsole for HeadlessConsole {
    fn write(&mut self, ch: u8) {
        self.output.push(ch);
    }

    fn has_key(&self) -> bool {
        !self.input.is_empty()
    }

    fn get_key(&mut self) -> Option<u8> {
        self.input.pop_front()
    }

    fn wait_for_key(&mut self) -> u8 {
        // For headless, just return from queue or 0 if empty
        self.input.pop_front().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_headless_console_output() {
        let mut console = HeadlessConsole::new();
        console.write(b'H');
        console.write(b'i');
        assert_eq!(console.output_string(), "Hi");
    }

    #[test]
    fn test_headless_console_input() {
        let mut console = HeadlessConsole::with_input(b"ABC");
        assert!(console.has_key());
        assert_eq!(console.get_key(), Some(b'A'));
        assert_eq!(console.get_key(), Some(b'B'));
        assert_eq!(console.get_key(), Some(b'C'));
        assert!(!console.has_key());
        assert_eq!(console.get_key(), None);
    }
}
