# Top-level Makefile for CPM project
# Builds both Rust (cpm-core, cpm-cli) and TypeScript (win95-sim)

.PHONY: all build test clean rust-build rust-test ts-build ts-test packages

# Default: build everything
all: build

# Build everything
build: rust-build ts-build

# Test everything
test: rust-test ts-test

# Rust targets
rust-build:
	cargo build --release

rust-test:
	cargo test

# TypeScript targets (win95-sim)
ts-build:
	$(MAKE) -C win95-sim build

ts-test:
	$(MAKE) -C win95-sim test

# Build packages (ZIP files)
packages:
	$(MAKE) -C win95-sim packages

# Clean everything
clean:
	cargo clean
	$(MAKE) -C win95-sim clean

# Development build (debug)
dev:
	cargo build

# Run the CLI
run:
	cargo run --bin cpm -- $(ARGS)

# Format code
fmt:
	cargo fmt
	cd win95-sim && npm run format 2>/dev/null || true

# Lint
lint:
	cargo clippy
	cd win95-sim && npm run lint 2>/dev/null || true
