BINARY_DIR=bin
ORCHESTRATOR_BIN=unit01
SANDBOX_BIN=sandbox
INDEXER_BIN=indexer

.PHONY: all build build-orchestrator build-rust test test-rust clean clean-rust clean-orchestrator release install

all: build

build: build-rust build-orchestrator

build-rust:
	@echo "Building Rust daemons (sandbox + indexer)..."
	cargo build --workspace --release 2>&1

build-orchestrator:
	@echo "Building orchestrator..."
	cd orchestrator && bun install && bun run build

test: test-rust

test-rust:
	@echo "Running Rust tests (sandbox + indexer)..."
	cargo test --workspace 2>&1

clean: clean-rust clean-orchestrator
	@rm -rf $(BINARY_DIR)

clean-rust:
	cargo clean 2>&1

clean-orchestrator:
	rm -rf orchestrator/node_modules orchestrator/dist

release: build-rust build-orchestrator
	@echo "Creating release binaries..."
	mkdir -p $(BINARY_DIR)
	cp target/release/$(SANDBOX_BIN) $(BINARY_DIR)/$(SANDBOX_BIN)
	cp target/release/$(INDEXER_BIN) $(BINARY_DIR)/$(INDEXER_BIN)
	cp -r orchestrator/bin/$(ORCHESTRATOR_BIN) $(BINARY_DIR)/$(ORCHESTRATOR_BIN)
	cp -r orchestrator/dist $(BINARY_DIR)/dist
	@echo "Binaries in $(BINARY_DIR)/:"
	ls -la $(BINARY_DIR)/

install: release
	@echo "Installing to /usr/local/bin..."
	sudo cp $(BINARY_DIR)/$(SANDBOX_BIN) /usr/local/bin/
	sudo cp $(BINARY_DIR)/$(INDEXER_BIN) /usr/local/bin/
	sudo cp $(BINARY_DIR)/$(ORCHESTRATOR_BIN) /usr/local/bin/$(ORCHESTRATOR_BIN)
	sudo mkdir -p /usr/local/lib/unit01
	sudo cp -r $(BINARY_DIR)/dist /usr/local/lib/unit01/dist
	@echo "Installation complete."
	@echo "Note: The orchestrator binary references dist/ relative to itself."
	@echo "If moved from /usr/local/bin/unit01, update the dist path in the script."
