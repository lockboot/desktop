//! Integration tests for package loading with real ZIP files.

use cpm_core::{load_package_from_path, DriveFS, PackageDriveFS};
use std::path::PathBuf;

fn get_package_path(name: &str) -> PathBuf {
    // Find the win95-sim/public/cpm directory relative to the crate
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("win95-sim/public/cpm")
        .join(name)
}

#[test]
fn test_load_cpm22_package() {
    let path = get_package_path("cpm22.zip");
    if !path.exists() {
        eprintln!("Skipping test - cpm22.zip not found at {:?}", path);
        return;
    }

    let pkg = load_package_from_path(&path).expect("Failed to load cpm22.zip");

    // Check manifest
    assert_eq!(pkg.manifest.name, "CP/M 2.2");
    assert_eq!(pkg.manifest.id, Some("cpm22".to_string()));
    assert_eq!(pkg.manifest.version, Some("2.2".to_string()));

    // Check that key files are present
    assert!(pkg.files.contains_key("CCP.COM"), "Missing CCP.COM");
    assert!(pkg.files.contains_key("ASM.COM"), "Missing ASM.COM");
    assert!(pkg.files.contains_key("DDT.COM"), "Missing DDT.COM");
    assert!(pkg.files.contains_key("ED.COM"), "Missing ED.COM");
    assert!(pkg.files.contains_key("PIP.COM"), "Missing PIP.COM");
    assert!(pkg.files.contains_key("STAT.COM"), "Missing STAT.COM");

    // Check actions
    assert!(!pkg.actions.is_empty(), "Expected actions");
    let asm_action = pkg.actions.iter().find(|a| a.id == "asm");
    assert!(asm_action.is_some(), "Expected ASM action");

    println!("Loaded {} files from cpm22.zip", pkg.files.len());
    for name in pkg.files.keys() {
        println!("  - {}", name);
    }
}

#[test]
fn test_load_turbo_pascal_package() {
    let path = get_package_path("turbo-pascal-3.zip");
    if !path.exists() {
        eprintln!(
            "Skipping test - turbo-pascal-3.zip not found at {:?}",
            path
        );
        return;
    }

    let pkg = load_package_from_path(&path).expect("Failed to load turbo-pascal-3.zip");

    assert_eq!(pkg.manifest.name, "Turbo Pascal 3");
    assert!(
        pkg.files.contains_key("TURBO.COM"),
        "Missing TURBO.COM"
    );

    // Check for interactive script action
    let turbo_action = pkg.actions.iter().find(|a| a.id == "turbo3");
    assert!(turbo_action.is_some(), "Expected turbo3 action");
    let action = turbo_action.unwrap();
    assert!(
        action.interactive_script.is_some(),
        "Expected interactive script"
    );
}

#[test]
fn test_package_drive_fs_with_real_package() {
    let path = get_package_path("cpm22.zip");
    if !path.exists() {
        return;
    }

    let pkg = load_package_from_path(&path).unwrap();
    let fs = PackageDriveFS::from_packages(vec![pkg]);

    // Test file operations
    assert!(fs.exists("CCP.COM"));
    assert!(fs.exists("ccp.com")); // case insensitive via to_8_3

    let ccp_data = fs.read_file("CCP.COM");
    assert!(ccp_data.is_some());
    let ccp = ccp_data.unwrap();
    assert!(!ccp.is_empty(), "CCP.COM should not be empty");

    // COM files start with machine code, not a magic header
    // Just verify it's a reasonable size for a shell
    assert!(ccp.len() > 100, "CCP.COM seems too small: {} bytes", ccp.len());

    let files = fs.list_files();
    println!("PackageDriveFS has {} files", files.len());
    assert!(files.len() >= 10, "Expected at least 10 files in cpm22");
}

#[test]
fn test_multiple_packages_merged() {
    let cpm22_path = get_package_path("cpm22.zip");
    let utilities_path = get_package_path("utilities.zip");

    if !cpm22_path.exists() || !utilities_path.exists() {
        return;
    }

    let cpm22 = load_package_from_path(&cpm22_path).unwrap();
    let utilities = load_package_from_path(&utilities_path).unwrap();

    let mut fs = PackageDriveFS::new();
    fs.add_package(cpm22);
    fs.add_package(utilities);

    // Should have files from both packages
    assert!(fs.exists("CCP.COM"), "Missing CCP.COM from cpm22");

    let files = fs.list_files();
    println!("Merged packages have {} files", files.len());
}
