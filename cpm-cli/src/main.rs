//! CP/M CLI - Run CP/M programs from the command line.
//!
//! Usage:
//!   cpm [packages/files...] [-- command args]
//!
//! Examples:
//!   cpm cpm22.zip                    # Load cpm22.zip, find and run shell
//!   cpm cpm22.zip utilities.zip      # Load multiple packages
//!   cpm cpm22.zip -- STAT            # Run STAT command directly
//!   cpm cpm22.zip hello.com          # Load package + add hello.com to A:
//!   cpm hello.com                    # Run hello.com directly (no shell)

use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use clap::Parser;
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    terminal::{disable_raw_mode, enable_raw_mode},
};
use tokio::sync::mpsc as tokio_mpsc;

use cpm_core::{
    load_package_from_path, CpmConsole, CpmEmulator, DriveFS, ExitReason, OverlayDriveFS,
    PackageDriveFS,
};

/// CP/M Emulator CLI
#[derive(Parser, Debug)]
#[command(name = "cpm")]
#[command(about = "Run CP/M programs")]
struct Args {
    /// Package ZIP files or .COM executables to load
    #[arg(required = true)]
    files: Vec<PathBuf>,

    /// Enable syscall tracing
    #[arg(short, long)]
    trace: bool,

    /// Command and arguments to run (instead of shell)
    #[arg(last = true)]
    command: Vec<String>,
}

/// Channel-based console that communicates via tokio channels.
struct ChannelConsole {
    /// Receiver for keyboard input
    key_rx: mpsc::Receiver<u8>,
    /// Pending keys (buffered)
    key_buffer: Vec<u8>,
}

impl ChannelConsole {
    fn new(key_rx: mpsc::Receiver<u8>) -> Self {
        Self {
            key_rx,
            key_buffer: Vec::new(),
        }
    }
}

impl CpmConsole for ChannelConsole {
    fn write(&mut self, ch: u8) {
        let stdout = std::io::stdout();
        let mut handle = stdout.lock();

        match ch {
            0x0D => {
                // CR - move to start of line
                let _ = handle.write_all(b"\r");
            }
            0x0A => {
                // LF - move down
                let _ = handle.write_all(b"\n");
            }
            0x08 => {
                // Backspace
                let _ = handle.write_all(b"\x08 \x08");
            }
            0x07 => {
                // Bell
                let _ = handle.write_all(b"\x07");
            }
            _ => {
                let _ = handle.write_all(&[ch]);
            }
        }
        let _ = handle.flush();
    }

    fn print(&mut self, ch: u8) {
        eprint!("{}", ch as char);
    }

    fn has_key(&self) -> bool {
        !self.key_buffer.is_empty()
    }

    fn get_key(&mut self) -> Option<u8> {
        // First check buffer
        if !self.key_buffer.is_empty() {
            return Some(self.key_buffer.remove(0));
        }

        // Try non-blocking receive
        match self.key_rx.try_recv() {
            Ok(ch) => Some(ch),
            Err(_) => None,
        }
    }

    fn wait_for_key(&mut self) -> u8 {
        // First check buffer
        if !self.key_buffer.is_empty() {
            return self.key_buffer.remove(0);
        }

        // Blocking receive
        match self.key_rx.recv() {
            Ok(ch) => ch,
            Err(_) => 0, // Channel closed
        }
    }
}

/// Translate crossterm key events to CP/M key codes.
fn translate_key(code: KeyCode, modifiers: KeyModifiers) -> Option<u8> {
    // Handle control characters
    if modifiers.contains(KeyModifiers::CONTROL) {
        match code {
            KeyCode::Char(c) => {
                let upper = c.to_ascii_uppercase();
                if upper.is_ascii_uppercase() {
                    return Some(upper as u8 - 64); // Ctrl+A=1, Ctrl+C=3, etc.
                }
            }
            _ => {}
        }
    }

    match code {
        KeyCode::Char(c) => Some(c as u8),
        KeyCode::Enter => Some(13),
        KeyCode::Backspace => Some(8),
        KeyCode::Tab => Some(9),
        KeyCode::Esc => Some(27),
        KeyCode::Up => Some(11),
        KeyCode::Down => Some(10),
        KeyCode::Left => Some(8),
        KeyCode::Right => Some(12),
        _ => None,
    }
}

/// Shell info with load address
struct ShellInfo {
    name: String,
    data: Vec<u8>,
    load_address: u16,
}

/// Find shell file from packages.
fn find_shell(packages: &[cpm_core::LoadedPackage]) -> Option<ShellInfo> {
    // First, look for shell type in manifest
    for pkg in packages {
        for file_entry in &pkg.manifest.files {
            if file_entry.file_type.as_deref() == Some("shell") {
                let filename = cpm_core::to_8_3(&file_entry.src);
                if let Some(data) = pkg.files.get(&filename) {
                    // Parse load address from manifest (e.g., "0xDC00")
                    let load_address = file_entry
                        .load_address
                        .as_ref()
                        .and_then(|s| {
                            let s = s.trim_start_matches("0x").trim_start_matches("0X");
                            u16::from_str_radix(s, 16).ok()
                        })
                        .unwrap_or(0x0100); // Default to TPA

                    return Some(ShellInfo {
                        name: filename,
                        data: data.clone(),
                        load_address,
                    });
                }
            }
        }
    }

    // Fallback: look for known shell names (default to TPA address)
    let shell_names = ["XCCP.COM", "CCP.COM", "ZCCP.COM"];
    for name in shell_names {
        for pkg in packages {
            if let Some(data) = pkg.files.get(name) {
                return Some(ShellInfo {
                    name: name.to_string(),
                    data: data.clone(),
                    load_address: 0x0100, // TPA for fallback shells
                });
            }
        }
    }

    None
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    // Separate packages (.zip) from loose files (.com)
    let mut packages = Vec::new();
    let mut loose_files: Vec<(String, Vec<u8>)> = Vec::new();

    for path in &args.files {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_uppercase();

        if ext == "ZIP" {
            // Load as package
            match load_package_from_path(path) {
                Ok(pkg) => {
                    eprintln!(
                        "Loaded package: {} ({} files)",
                        pkg.manifest.name,
                        pkg.files.len()
                    );
                    packages.push(pkg);
                }
                Err(e) => {
                    eprintln!("Failed to load {}: {}", path.display(), e);
                    return Err(e.into());
                }
            }
        } else if ext == "COM" {
            // Load as loose .COM file
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("UNKNOWN.COM")
                .to_uppercase();
            match std::fs::read(path) {
                Ok(data) => {
                    //eprintln!("Loaded executable: {}", filename);
                    loose_files.push((filename, data));
                }
                Err(e) => {
                    eprintln!("Failed to read {}: {}", path.display(), e);
                    return Err(e.into());
                }
            }
        } else {
            eprintln!("Unknown file type: {} (expected .zip or .com)", path.display());
            return Err(format!("Unknown file type: {}", path.display()).into());
        }
    }

    if packages.is_empty() && loose_files.is_empty() {
        eprintln!("No packages or executables loaded");
        return Ok(());
    }

    // Determine execution mode:
    // 1. If packages with shell: use shell (optionally run command)
    // 2. If only loose .com files: run first one directly at 0x100
    let shell = find_shell(&packages);

    // Validate we have something to run
    if shell.is_none() && loose_files.is_empty() {
        eprintln!("No shell found in packages and no .COM files provided.");
        return Err("Nothing to run".into());
    }

    if let Some(ref s) = shell {
        eprintln!(
            "Using shell: {} (load address: 0x{:04X})",
            s.name, s.load_address
        );
    }

    // Create filesystem from packages
    let base_fs = PackageDriveFS::from_packages(packages);
    let mut overlay_fs = OverlayDriveFS::new(base_fs);

    // Add loose .COM files to the overlay (A: drive)
    for (filename, data) in &loose_files {
        overlay_fs.write_file(filename, data)?;
        //eprintln!("Added {} to A: drive", filename);
    }

    // Determine what to run and how
    let (program_data, start_address, use_shell): (Vec<u8>, u16, bool) = if let Some(s) = shell {
        // Shell mode: load shell, optionally pass command
        (s.data, s.load_address, true)
    } else {
        // Direct mode: run first .com file at TPA (0x100)
        let (first_name, first_data) = loose_files.first().unwrap();
        //eprintln!("Running {} directly", first_name);
        (first_data.clone(), 0x0100, false)
    };

    // Create channel for keyboard input
    let (key_tx, key_rx) = mpsc::channel::<u8>();

    // Create shutdown signal
    let (shutdown_tx, mut shutdown_rx) = tokio_mpsc::channel::<()>(1);

    // Create console
    let console = ChannelConsole::new(key_rx);

    // Enable raw mode (gracefully handle non-TTY)
    let raw_mode_enabled = enable_raw_mode().is_ok();

    let trace = args.trace;
    let command = args.command.clone();

    // Spawn emulator in blocking task
    let emu_handle = tokio::task::spawn_blocking(move || {
        let mut emu: CpmEmulator<ChannelConsole, OverlayDriveFS<PackageDriveFS>> =
            CpmEmulator::new(console);
        emu.trace = trace;
        emu.mount(0, overlay_fs);

        if use_shell {
            // Shell mode: set shell for warm boot, pass command as args
            emu.set_shell(&program_data, start_address);
        } else {
            // Direct mode: load program at TPA, no shell for warm boot
            emu.load_at(start_address, &program_data);
        }

        // Set command line args (works for both shell and direct mode)
        if !command.is_empty() {
            let cmd_line = command.join(" ");
            emu.set_args(&cmd_line);
        }

        emu.run_from(start_address)
    });

    // Spawn terminal input reader
    let input_handle = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                _ = tokio::time::sleep(Duration::from_millis(10)) => {
                    // Poll for terminal events
                    if event::poll(Duration::from_millis(0)).unwrap_or(false) {
                        if let Ok(Event::Key(key_event)) = event::read() {
                            if let Some(ch) = translate_key(key_event.code, key_event.modifiers) {
                                if key_tx.send(ch).is_err() {
                                    break; // Channel closed
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Wait for emulator to finish
    let result = emu_handle.await?;

    // Signal input handler to stop
    let _ = shutdown_tx.send(()).await;
    let _ = input_handle.await;

    // Disable raw mode if we enabled it
    if raw_mode_enabled {
        let _ = disable_raw_mode();
    }

    match result {
        Ok(_info) => {
            //eprintln!("\nProgram exited: {:?}", info.reason);
            //if info.reason == ExitReason::WarmBoot {
            //    eprintln!("(Normal exit via warm boot)");
            //}
        }
        Err(e) => {
            eprintln!("\nError: {}", e);
        }
    }

    Ok(())
}
