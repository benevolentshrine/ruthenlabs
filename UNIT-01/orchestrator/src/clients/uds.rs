use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::time::{timeout, Duration};

#[derive(Debug)]
pub struct UDSClient {
    pub socket_path: String,
}

impl UDSClient {
    pub fn new(socket_path: &str) -> Self {
        Self {
            socket_path: socket_path.to_string(),
        }
    }

    pub fn is_available(&self) -> bool {
        Path::new(&self.socket_path).exists()
    }

    pub async fn call<T: DeserializeOwned>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T, String> {
        let stream = timeout(
            Duration::from_secs(2),
            UnixStream::connect(&self.socket_path),
        )
        .await
        .map_err(|e| format!("connect timeout: {}", e))?
        .map_err(|e| format!("connect failed: {}", e))?;

        let (mut reader, mut writer) = stream.into_split();

        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": 1
        });

        let mut buf = serde_json::to_vec(&req).map_err(|e| format!("serialize: {}", e))?;
        buf.push(b'\n');

        timeout(Duration::from_secs(2), writer.write_all(&buf))
            .await
            .map_err(|e| format!("write timeout: {}", e))?
            .map_err(|e| format!("write failed: {}", e))?;

        let mut resp_buf = Vec::new();
        timeout(Duration::from_secs(10), reader.read_to_end(&mut resp_buf))
            .await
            .map_err(|e| format!("read timeout: {}", e))?
            .map_err(|e| format!("read failed: {}", e))?;

        let resp: Value =
            serde_json::from_slice(&resp_buf).map_err(|e| format!("json parse: {}", e))?;

        if let Some(err) = resp.get("error") {
            return Err(format!("RPC error: {}", err));
        }

        let result = resp
            .get("result")
            .ok_or_else(|| "no result in response".to_string())?;

        serde_json::from_value(result.clone()).map_err(|e| format!("result parse: {}", e))
    }
}
