package main

import (
	"errors"
	"net"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// ─── Daemon Manager ───────────────────────────────────────────────────────────

type DaemonStatus int

const (
	StatusNotFound DaemonStatus = iota // binary not on PATH
	StatusOffline                    // binary found, socket missing
	StatusReady                      // socket available
)

type DaemonManager struct {
	processes map[string]*os.Process
}

func NewDaemonManager() *DaemonManager {
	return &DaemonManager{
		processes: make(map[string]*os.Process),
	}
}

// SpawnIfMissing checks for the binary and socket. If binary exists but socket
// is missing, it spawns the daemon in the background.
func (d *DaemonManager) SpawnIfMissing(name, socketPath string) DaemonStatus {
	home, _ := os.UserHomeDir()
	// Map common names to their absolute release paths in RuthenLabs
	binPath := ""
	args := []string{}

	switch name {
	case "indexer":
		binPath = home + "/.ruthen/unit01/bin/indexer"
		args = []string{"daemon", "start"}
	case "sandbox":
		binPath = home + "/.ruthen/unit01/bin/sandbox"
		args = []string{"daemon"}
	default:
		p, err := exec.LookPath(name)
		if errors.Is(err, os.ErrNotExist) {
			return StatusNotFound
		}
		binPath = p
		args = []string{"--daemon"}
	}

	if _, err := os.Stat(binPath); err != nil {
		return StatusNotFound
	}

	// Check if socket already exists and is responsive.
	if _, err := os.Stat(socketPath); err == nil {
		// Try to connect to see if it's actually alive
		conn, connErr := net.DialTimeout("unix", socketPath, 100*time.Millisecond)
		if connErr == nil {
			conn.Close()
			return StatusReady
		}
		// If socket exists but connection refused, it's a stale socket.
		// Clean it up so we can spawn a fresh one.
		os.Remove(socketPath)
	}

	// Ensure parent directory exists for the socket
	if err := os.MkdirAll("/tmp/ruthen", 0755); err != nil {
		return StatusOffline
	}

	// Spawn daemon.
	cmd := exec.Command(binPath, args...)
	
	// Detach stdout/stderr.
	logFile, _ := os.OpenFile("/tmp/sandbox_unit01.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	
	if err := cmd.Start(); err != nil {
		return StatusOffline
	}

	// Track process for cleanup.
	d.processes[name] = cmd.Process

	// Give it up to 5 seconds to create the socket.
	for i := 0; i < 10; i++ {
		time.Sleep(500 * time.Millisecond)
		if _, err := os.Stat(socketPath); err == nil {
			return StatusReady
		}
	}
	return StatusOffline
}

// Shutdown sends SIGTERM to all spawned daemons.
func (d *DaemonManager) Shutdown() {
	for _, p := range d.processes {
		_ = p.Signal(syscall.SIGTERM)
	}
}
