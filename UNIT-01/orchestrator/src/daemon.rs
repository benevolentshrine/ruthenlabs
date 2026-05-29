use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DaemonStatus {
    NotFound,
    Offline,
    Ready,
}

pub struct DaemonManager {
    processes: Arc<Mutex<HashMap<String, Child>>>,
}

impl DaemonManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn spawn_if_missing(&self, name: &str, socket_path: &str) -> DaemonStatus {
        let home = home::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/tmp".to_string());

        let (bin_path, args) = match name {
            "indexer" => (
                format!("{}/.ruthen/unit01/bin/indexer", home),
                vec!["daemon".to_string(), "start".to_string()],
            ),
            "sandbox" => (
                format!("{}/.ruthen/unit01/bin/sandbox", home),
                vec!["daemon".to_string()],
            ),
            _ => return DaemonStatus::NotFound,
        };

        if !Path::new(&bin_path).exists() {
            return DaemonStatus::NotFound;
        }

        if Path::new(socket_path).exists() {
            match tokio::net::UnixStream::connect(socket_path).await {
                Ok(_) => return DaemonStatus::Ready,
                Err(_) => {
                    let _ = tokio::fs::remove_file(socket_path).await;
                }
            }
        }

        let _ = tokio::fs::create_dir_all("/tmp/ruthen").await;

        let log_path = "/tmp/sandbox_unit01.log";
        let log_file = std::fs::File::create(log_path).ok();

        match Command::new(&bin_path)
            .args(&args)
            .stdout(if let Some(ref f) = log_file {
                Stdio::from(f.try_clone().unwrap())
            } else {
                Stdio::null()
            })
            .stderr(if let Some(ref f) = log_file {
                Stdio::from(f.try_clone().unwrap())
            } else {
                Stdio::null()
            })
            .spawn()
        {
            Ok(child) => {
                self.processes.lock().await.insert(name.to_string(), child);

                for _ in 0..10 {
                    sleep(Duration::from_millis(500)).await;
                    if Path::new(socket_path).exists() {
                        return DaemonStatus::Ready;
                    }
                }
                DaemonStatus::Offline
            }
            Err(_) => DaemonStatus::Offline,
        }
    }

    pub async fn shutdown(&self) {
        let mut procs = self.processes.lock().await;
        for (_, mut child) in procs.drain() {
            let _ = child.kill().await;
        }
    }
}
