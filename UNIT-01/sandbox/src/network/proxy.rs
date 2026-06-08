use crate::network::domains;
use anyhow::Result;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;

/// Lightweight HTTP CONNECT + forward proxy with domain allowlist enforcement.
/// The allowlist is shared via RwLock so it can be updated at runtime without
/// restarting the proxy.
pub struct SandboxProxy {
    pub port: u16,
    shutdown: Arc<Notify>,
}

impl SandboxProxy {
    pub async fn start(
        allowed_domains: Arc<std::sync::RwLock<Vec<String>>>,
    ) -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let shutdown = Arc::new(Notify::new());

        let sd = shutdown.clone();
        tokio::spawn(async move {
            run_proxy_loop(listener, allowed_domains, sd).await;
        });

        tracing::info!("[PROXY] Egress proxy listening on 127.0.0.1:{}", port);
        Ok(Self { port, shutdown })
    }

    pub fn shutdown(&self) {
        self.shutdown.notify_one();
    }
}

impl Drop for SandboxProxy {
    fn drop(&mut self) {
        self.shutdown.notify_one();
    }
}

fn current_allowlist(
    domains: &Arc<std::sync::RwLock<Vec<String>>>,
) -> Vec<String> {
    domains.read().unwrap_or_else(|e| e.into_inner()).clone()
}

async fn run_proxy_loop(
    listener: TcpListener,
    allowed_domains: Arc<std::sync::RwLock<Vec<String>>>,
    shutdown: Arc<Notify>,
) {
    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, _)) => {
                        let domains = allowed_domains.clone();
                        tokio::spawn(async move {
                            let list = current_allowlist(&domains);
                            if let Err(e) = handle_proxy_connection(stream, &list).await {
                                tracing::debug!("[PROXY] Connection error: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        tracing::error!("[PROXY] Accept error: {}", e);
                        break;
                    }
                }
            }
            _ = shutdown.notified() => {
                tracing::info!("[PROXY] Shutting down");
                break;
            }
        }
    }
}

async fn handle_proxy_connection(
    mut inbound: TcpStream,
    allowed_domains: &[String],
) -> Result<()> {
    let mut buf = vec![0u8; 16384];
    let n = inbound.read(&mut buf).await?;
    if n == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buf[..n]);
    let initial = buf[..n].to_vec();

    if request.starts_with("CONNECT") {
        handle_connect(inbound, &request, allowed_domains).await
    } else {
        handle_http_proxy(inbound, &request, initial, allowed_domains).await
    }
}

async fn handle_connect(
    mut inbound: TcpStream,
    request: &str,
    allowed_domains: &[String],
) -> Result<()> {
    let host = request
        .lines()
        .next()
        .and_then(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            parts.get(1).map(|s| s.to_string())
        })
        .unwrap_or_default();

    if !domains::check_domain(&host, allowed_domains) {
        tracing::warn!("[PROXY] BLOCKED CONNECT to {}", host);
        let _ = inbound
            .write_all(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            .await;
        return Ok(());
    }

    let target = format!("{}", host);
    let upstream = match TcpStream::connect(&target).await {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!("[PROXY] CONNECT upstream failed {}: {}", target, e);
            let _ = inbound
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                .await;
            return Ok(());
        }
    };

    let _ = inbound.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await;
    relay_bidirectional(inbound, upstream).await;
    Ok(())
}

async fn handle_http_proxy(
    mut inbound: TcpStream,
    request: &str,
    _initial_buf: Vec<u8>,
    allowed_domains: &[String],
) -> Result<()> {
    let host = request
        .lines()
        .next()
        .and_then(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            parts.get(1).and_then(|url| {
                let url_str = url.to_string();
                if url_str.starts_with("http://") || url_str.starts_with("https://") {
                    url_str
                        .split('/')
                        .nth(2)
                        .map(|s| {
                            let s: &str = s;
                            s.split(':').next().unwrap_or(s).to_string()
                        })
                } else {
                    url_str.split(':').next().map(|s| s.to_string())
                }
            })
        })
        .unwrap_or_default();

    if !domains::check_domain(&host, allowed_domains) {
        tracing::warn!("[PROXY] BLOCKED HTTP request to {}", host);
        let _ = inbound
            .write_all(b"HTTP/1.1 403 Forbidden\r\nProxy-Agent: Ruthen-Sandbox\r\n\r\n")
            .await;
        return Ok(());
    }

    // Forward: rewrite absolute URL to relative, connect to target, relay
    let first_line = request.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 3 {
        return Ok(());
    }

    let method = parts[0];
    let full_url = parts[1];
    let version = parts[2];

    // Extract path from URL
    let path = if let Some(pos) = full_url.find("://") {
        if let Some(slash_pos) = full_url[pos + 3..].find('/') {
            &full_url[pos + 3 + slash_pos..]
        } else {
            "/"
        }
    } else {
        full_url
    };

    let target = if host.contains(':') {
        host.clone()
    } else {
        format!("{}:80", host)
    };

    let mut upstream = match TcpStream::connect(&target).await {
        Ok(s) => s,
        Err(_) => {
            let _ = inbound
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                .await;
            return Ok(());
        }
    };

    // Rebuild request with relative URL and proper Host header
    let mut relative_request = format!("{} {} {}\r\n", method, path, version);
    let rest: Vec<&str> = request.lines().skip(1).collect();
    let mut has_host = false;
    for line in &rest {
        if line.is_empty() {
            break;
        }
        if line.to_lowercase().starts_with("host:") {
            has_host = true;
            relative_request.push_str(&format!("Host: {}\r\n", host));
        } else {
            relative_request.push_str(line);
            relative_request.push_str("\r\n");
        }
    }
    if !has_host {
        relative_request.push_str(&format!("Host: {}\r\n", host));
    }
    relative_request.push_str("\r\n");

    if let Err(_) = upstream.write_all(relative_request.as_bytes()).await {
        return Ok(());
    }

    relay_bidirectional(inbound, upstream).await;
    Ok(())
}

async fn relay_bidirectional(mut a: TcpStream, mut b: TcpStream) {
    let (mut a_r, mut a_w) = a.split();
    let (mut b_r, mut b_w) = b.split();
    let _ = tokio::join!(
        tokio::io::copy(&mut a_r, &mut b_w),
        tokio::io::copy(&mut b_r, &mut a_w),
    );
}
