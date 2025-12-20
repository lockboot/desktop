//! Package loading from ZIP files with manifest support.
//!
//! Packages are ZIP files containing CP/M files and an optional `manifest.mf` JSON file.
//! The manifest describes the package metadata, files, and actions.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek};

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

use crate::error::{CpmError, CpmResult};
use crate::fs::{to_8_3, DriveFS};

/// Action defined in a package manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageAction {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub output_exts: Vec<String>,
    #[serde(default)]
    pub submit: Option<String>,
    #[serde(default)]
    pub interactive_script: Option<Vec<InteractiveStep>>,
    /// Package that provides this action (filled at load time)
    #[serde(skip)]
    pub package: Option<String>,
}

/// Interactive script step for menu-driven tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractiveStep {
    pub wait: String,
    pub send: String,
}

/// File entry in a package manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub src: String,
    #[serde(default)]
    pub dst: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub load_address: Option<String>,
    #[serde(rename = "type")]
    #[serde(default)]
    pub file_type: Option<String>,
}

/// Package manifest schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageManifest {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub files: Vec<FileEntry>,
    #[serde(default)]
    pub meta: Option<serde_json::Value>,
    #[serde(default)]
    pub actions: Vec<PackageAction>,
}

/// Loaded package with files and actions.
#[derive(Debug, Clone)]
pub struct LoadedPackage {
    pub manifest: PackageManifest,
    pub files: HashMap<String, Vec<u8>>,
    pub actions: Vec<PackageAction>,
}

/// Load packages from ZIP data.
/// Supports manifest.mf as single object or array of objects.
/// Returns multiple packages if the manifest is an array.
pub fn load_packages<R: Read + Seek>(reader: R) -> CpmResult<Vec<LoadedPackage>> {
    let mut archive = ZipArchive::new(reader).map_err(CpmError::Zip)?;
    let mut all_files: HashMap<String, Vec<u8>> = HashMap::new();
    let mut manifests: Vec<PackageManifest> = Vec::new();

    // Extract all files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(CpmError::Zip)?;
        if file.is_dir() {
            continue;
        }

        let name = file.name().to_string();
        let upper_name = name.to_uppercase();

        let mut content = Vec::new();
        file.read_to_end(&mut content)?;

        // Check for manifest
        if upper_name == "MANIFEST.MF" || upper_name.ends_with("/MANIFEST.MF") {
            if let Ok(text) = std::str::from_utf8(&content) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) {
                    manifests = normalize_manifest_data(parsed);
                }
            }
        } else {
            // Store with 8.3 filename (CP/M format)
            // Handle nested paths - take just the filename
            let filename = name.rsplit('/').next().unwrap_or(&name);
            all_files.insert(to_8_3(filename), content);
        }
    }

    // Create default manifest if none found
    if manifests.is_empty() {
        manifests.push(PackageManifest {
            id: None,
            name: "Unknown Package".to_string(),
            version: None,
            description: None,
            output_dir: None,
            files: all_files
                .keys()
                .map(|name| FileEntry {
                    src: name.clone(),
                    dst: None,
                    required: None,
                    load_address: None,
                    file_type: None,
                })
                .collect(),
            meta: None,
            actions: Vec::new(),
        });
    }

    // Create a LoadedPackage for each manifest
    let mut packages: Vec<LoadedPackage> = Vec::new();
    let mut assigned_files: HashSet<String> = HashSet::new();

    for manifest in manifests {
        let mut pkg_files: HashMap<String, Vec<u8>> = HashMap::new();
        let mut actions: Vec<PackageAction> = Vec::new();

        // Get files listed in this manifest
        for file_entry in &manifest.files {
            let fname = to_8_3(&file_entry.src);
            if let Some(content) = all_files.get(&fname) {
                pkg_files.insert(fname.clone(), content.clone());
                assigned_files.insert(fname);
            }
        }

        // Collect actions for this package
        for action in &manifest.actions {
            let mut action = action.clone();
            action.package = Some(manifest.id.clone().unwrap_or_else(|| manifest.name.clone()));
            actions.push(action);
        }

        packages.push(LoadedPackage {
            manifest,
            files: pkg_files,
            actions,
        });
    }

    // Any unassigned files go to the first package
    if !packages.is_empty() {
        for (fname, content) in &all_files {
            if !assigned_files.contains(fname) {
                packages[0].files.insert(fname.clone(), content.clone());
            }
        }
    }

    Ok(packages)
}

/// Load a single package from ZIP data (convenience wrapper).
pub fn load_package<R: Read + Seek>(reader: R) -> CpmResult<LoadedPackage> {
    let packages = load_packages(reader)?;
    if packages.is_empty() {
        return Ok(LoadedPackage {
            manifest: PackageManifest {
                id: None,
                name: "Empty Package".to_string(),
                version: None,
                description: None,
                output_dir: None,
                files: Vec::new(),
                meta: None,
                actions: Vec::new(),
            },
            files: HashMap::new(),
            actions: Vec::new(),
        });
    }
    if packages.len() == 1 {
        return Ok(packages.into_iter().next().unwrap());
    }
    // Multiple packages - merge into one
    let mut merged = LoadedPackage {
        manifest: packages[0].manifest.clone(),
        files: HashMap::new(),
        actions: Vec::new(),
    };
    for pkg in packages {
        for (name, data) in pkg.files {
            merged.files.insert(name, data);
        }
        merged.actions.extend(pkg.actions);
    }
    Ok(merged)
}

/// Load a package from a file path.
pub fn load_package_from_path(path: &std::path::Path) -> CpmResult<LoadedPackage> {
    let file = std::fs::File::open(path)?;
    load_package(std::io::BufReader::new(file))
}

/// Normalize manifest data to array format.
fn normalize_manifest_data(data: serde_json::Value) -> Vec<PackageManifest> {
    if let Ok(arr) = serde_json::from_value::<Vec<PackageManifest>>(data.clone()) {
        return arr;
    }
    if let Ok(single) = serde_json::from_value::<PackageManifest>(data) {
        return vec![single];
    }
    Vec::new()
}

/// Check if a filename matches an action's patterns.
pub fn action_matches_file(action: &PackageAction, filename: &str) -> bool {
    let upper = filename.to_uppercase();
    action.patterns.iter().any(|pattern| {
        let upper_pattern = pattern.to_uppercase();
        // Simple glob matching: *.EXT matches files with that extension
        if let Some(ext) = upper_pattern.strip_prefix('*') {
            upper.ends_with(&ext)
        } else {
            // Exact match
            upper == upper_pattern
        }
    })
}

/// Expand a submit template with the given basename and drive.
pub fn expand_submit_template(
    action: &PackageAction,
    base_name: &str,
    drive: Option<char>,
) -> String {
    let template = action
        .submit
        .as_ref()
        .map(|s| s.as_str())
        .unwrap_or_else(|| "{command} {name}\r");

    let mut result = template
        .replace("{command}", &action.command)
        .replace("{name}", base_name);

    if let Some(d) = drive {
        result = result.replace("{drive}", &d.to_string());
    }

    result
}

/// Read-only filesystem backed by loaded packages.
/// Multiple packages are merged (later packages override earlier ones).
#[derive(Debug, Clone)]
pub struct PackageDriveFS {
    files: HashMap<String, Vec<u8>>,
    file_origins: HashMap<String, String>,
    packages: Vec<LoadedPackage>,
    all_actions: Vec<PackageAction>,
}

impl PackageDriveFS {
    /// Create a new empty PackageDriveFS.
    pub fn new() -> Self {
        Self {
            files: HashMap::new(),
            file_origins: HashMap::new(),
            packages: Vec::new(),
            all_actions: Vec::new(),
        }
    }

    /// Create a PackageDriveFS from a list of packages.
    pub fn from_packages(packages: Vec<LoadedPackage>) -> Self {
        let mut fs = Self::new();
        for pkg in packages {
            fs.add_package(pkg);
        }
        fs
    }

    /// Add a package (files are merged, later overrides earlier).
    pub fn add_package(&mut self, pkg: LoadedPackage) {
        let pkg_name = pkg.manifest.name.clone();
        for (name, data) in &pkg.files {
            let fname = to_8_3(name);
            self.files.insert(fname.clone(), data.clone());
            self.file_origins.insert(fname, pkg_name.clone());
        }
        // Collect actions
        for action in &pkg.actions {
            self.all_actions.push(action.clone());
        }
        self.packages.push(pkg);
    }

    /// Remove a package by name.
    pub fn remove_package(&mut self, name: &str) -> bool {
        let idx = self.packages.iter().position(|p| p.manifest.name == name);
        if let Some(idx) = idx {
            self.packages.remove(idx);
            // Rebuild files, origins, and actions
            self.files.clear();
            self.file_origins.clear();
            self.all_actions.clear();
            let packages = std::mem::take(&mut self.packages);
            for pkg in packages {
                self.add_package(pkg);
            }
            true
        } else {
            false
        }
    }

    /// Get all actions from all packages.
    pub fn get_actions(&self) -> &[PackageAction] {
        &self.all_actions
    }

    /// Get all loaded packages.
    pub fn get_packages(&self) -> &[LoadedPackage] {
        &self.packages
    }

    /// Get which package a file came from.
    pub fn get_file_origin(&self, name: &str) -> Option<&str> {
        self.file_origins.get(&to_8_3(name)).map(|s| s.as_str())
    }

    /// Generate virtual MANIFEST.MF content from all packages.
    fn get_manifest_content(&self) -> Vec<u8> {
        let manifests: Vec<&PackageManifest> = self.packages.iter().map(|p| &p.manifest).collect();
        let json = if manifests.len() == 1 {
            serde_json::to_string_pretty(&manifests[0]).unwrap_or_default()
        } else {
            serde_json::to_string_pretty(&manifests).unwrap_or_default()
        };
        json.into_bytes()
    }
}

impl Default for PackageDriveFS {
    fn default() -> Self {
        Self::new()
    }
}

impl DriveFS for PackageDriveFS {
    fn read_file(&self, name: &str) -> Option<Vec<u8>> {
        let fname = to_8_3(name);
        // Virtual MANIFEST.MF
        if fname == "MANIFEST.MF" && !self.packages.is_empty() {
            return Some(self.get_manifest_content());
        }
        self.files.get(&fname).cloned()
    }

    fn write_file(&mut self, _name: &str, _data: &[u8]) -> CpmResult<()> {
        Err(CpmError::ReadOnly)
    }

    fn delete_file(&mut self, name: &str) -> bool {
        eprintln!("PackageDriveFS is read-only, ignoring delete of {}", name);
        false
    }

    fn list_files(&self) -> Vec<String> {
        let mut files: Vec<String> = self.files.keys().cloned().collect();
        // Add virtual MANIFEST.MF if we have packages
        if !self.packages.is_empty() && !files.contains(&"MANIFEST.MF".to_string()) {
            files.push("MANIFEST.MF".to_string());
        }
        files.sort();
        files
    }

    fn exists(&self, name: &str) -> bool {
        let fname = to_8_3(name);
        // Virtual MANIFEST.MF
        if fname == "MANIFEST.MF" && !self.packages.is_empty() {
            return true;
        }
        self.files.contains_key(&fname)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn create_test_zip() -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut zip = zip::ZipWriter::new(cursor);

            // Add manifest
            let manifest = r#"{
                "id": "test-pkg",
                "name": "Test Package",
                "version": "1.0",
                "files": [
                    { "src": "HELLO.COM" },
                    { "src": "TEST.TXT" }
                ],
                "actions": [
                    {
                        "id": "run",
                        "name": "Run",
                        "command": "HELLO",
                        "patterns": ["*.COM"]
                    }
                ]
            }"#;
            zip.start_file::<_, ()>("manifest.mf", Default::default())
                .unwrap();
            use std::io::Write;
            zip.write_all(manifest.as_bytes()).unwrap();

            // Add files
            zip.start_file::<_, ()>("HELLO.COM", Default::default())
                .unwrap();
            zip.write_all(b"\xC3\x00\x00").unwrap(); // JP 0

            zip.start_file::<_, ()>("TEST.TXT", Default::default())
                .unwrap();
            zip.write_all(b"Hello World").unwrap();

            zip.finish().unwrap();
        }
        buf
    }

    #[test]
    fn test_load_package() {
        let zip_data = create_test_zip();
        let pkg = load_package(Cursor::new(zip_data)).unwrap();

        assert_eq!(pkg.manifest.name, "Test Package");
        assert_eq!(pkg.manifest.id, Some("test-pkg".to_string()));
        assert_eq!(pkg.files.len(), 2);
        assert!(pkg.files.contains_key("HELLO.COM"));
        assert!(pkg.files.contains_key("TEST.TXT"));
        assert_eq!(pkg.actions.len(), 1);
        assert_eq!(pkg.actions[0].id, "run");
    }

    #[test]
    fn test_package_drive_fs() {
        let zip_data = create_test_zip();
        let pkg = load_package(Cursor::new(zip_data)).unwrap();
        let fs = PackageDriveFS::from_packages(vec![pkg]);

        assert!(fs.exists("HELLO.COM"));
        assert!(fs.exists("TEST.TXT"));
        assert!(fs.exists("MANIFEST.MF")); // virtual

        let content = fs.read_file("TEST.TXT").unwrap();
        assert_eq!(content, b"Hello World");

        let files = fs.list_files();
        assert!(files.contains(&"HELLO.COM".to_string()));
        assert!(files.contains(&"TEST.TXT".to_string()));
        assert!(files.contains(&"MANIFEST.MF".to_string()));
    }

    #[test]
    fn test_action_matches_file() {
        let action = PackageAction {
            id: "test".to_string(),
            name: "Test".to_string(),
            command: "TEST".to_string(),
            patterns: vec!["*.ASM".to_string(), "*.COM".to_string()],
            output_exts: vec![],
            submit: None,
            interactive_script: None,
            package: None,
        };

        assert!(action_matches_file(&action, "TEST.ASM"));
        assert!(action_matches_file(&action, "hello.com"));
        assert!(!action_matches_file(&action, "test.txt"));
    }

    #[test]
    fn test_expand_submit_template() {
        let action = PackageAction {
            id: "asm".to_string(),
            name: "ASM".to_string(),
            command: "ASM".to_string(),
            patterns: vec!["*.ASM".to_string()],
            output_exts: vec![],
            submit: Some("{drive}:\rA:ASM {drive}:{name}\r".to_string()),
            interactive_script: None,
            package: None,
        };

        let result = expand_submit_template(&action, "TEST", Some('B'));
        assert_eq!(result, "B:\rA:ASM B:TEST\r");
    }
}
