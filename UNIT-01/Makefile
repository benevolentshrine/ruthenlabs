BINARY_DIR=bin
ORCHESTRATOR_BIN=unit-01
SANDBOX_BIN=sandbox
INDEXER_BIN=indexer

.PHONY: all build build-orchestrator build-rust test test-orchestrator test-rust clean clean-rust clean-orchestrator release install

all: build

build: build-rust build-orchestrator

build-rust:
	@echo "Building Rust daemons (sandbox + indexer)..."
	cargo build --workspace --release 2>&1

build-orchestrator:
	@echo "Building Go orchestrator..."
	$(MAKE) -C orchestrator build

test: test-rust test-orchestrator

test-rust:
	@echo "Running Rust tests (sandbox + indexer)..."
	cargo test --workspace 2>&1

test-orchestrator:
	@echo "Running Go orchestrator tests..."
	$(MAKE) -C orchestrator test

clean: clean-rust clean-orchestrator
	@rm -rf $(BINARY_DIR)

clean-rust:
	cargo clean 2>&1

clean-orchestrator:
	$(MAKE) -C orchestrator clean

release: build-rust build-orchestrator
	@echo "Creating release binaries..."
	mkdir -p $(BINARY_DIR)
	cp target/release/$(SANDBOX_BIN) $(BINARY_DIR)/$(SANDBOX_BIN)
	cp target/release/$(INDEXER_BIN) $(BINARY_DIR)/$(INDEXER_BIN)
	cp orchestrator/$(ORCHESTRATOR_BIN) $(BINARY_DIR)/$(ORCHESTRATOR_BIN)
	@echo "Binaries in $(BINARY_DIR)/:"
	ls -la $(BINARY_DIR)/

install: release
	@echo "Installing to /usr/local/bin..."
	sudo cp $(BINARY_DIR)/$(SANDBOX_BIN) /usr/local/bin/
	sudo cp $(BINARY_DIR)/$(INDEXER_BIN) /usr/local/bin/
	sudo cp $(BINARY_DIR)/$(ORCHESTRATOR_BIN) /usr/local/bin/
	@echo "Installation complete."
