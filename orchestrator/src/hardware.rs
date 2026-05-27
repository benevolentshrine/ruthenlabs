use std::process::Command;

pub fn system_ram_gb() -> u64 {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("sysctl").args(["-n", "hw.memsize"]).output() {
            if let Ok(s) = String::from_utf8(out.stdout) {
                if let Ok(bytes) = s.trim().parse::<u64>() {
                    return bytes / (1024 * 1024 * 1024);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = Command::new("sh").args(["-c", "grep MemTotal /proc/meminfo"]).output() {
            if let Ok(s) = String::from_utf8(out.stdout) {
                for field in s.split_whitespace() {
                    if let Ok(kb) = field.parse::<u64>() {
                        return kb / (1024 * 1024);
                    }
                }
            }
        }
    }

    16
}
