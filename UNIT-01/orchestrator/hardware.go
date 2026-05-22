package main

import (
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// SystemRAMGB detects total system RAM in GB. Used for informational display
// and coarse capacity hints (e.g., can a 70B model even load).
func SystemRAMGB() int {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
		if err == nil {
			bytes, err := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
			if err == nil {
				return int(bytes / (1024 * 1024 * 1024))
			}
		}
	case "linux":
		out, err := exec.Command("grep", "MemTotal", "/proc/meminfo").Output()
		if err == nil {
			fields := strings.Fields(string(out))
			if len(fields) >= 2 {
				kb, err := strconv.ParseUint(fields[1], 10, 64)
				if err == nil {
					return int(kb / (1024 * 1024))
				}
			}
		}
	}

	return 16 // safe fallback
}
