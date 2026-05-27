use super::uds::UDSClient;
use serde::Deserialize;
use serde_json::json;

pub struct SandboxClient {
    client: UDSClient,
}

impl SandboxClient {
    pub fn new() -> Self {
        Self { client: UDSClient::new("/tmp/ruthen/sandbox.sock") }
    }

    pub async fn execute(&self, cmd: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct ExecResult { verdict: String, stdout: String }

        let res: ExecResult = self.client.call("execute", json!({"cmd": cmd, "cwd": "."})).await?;
        Ok(if !res.stdout.is_empty() { res.stdout } else { res.verdict })
    }

    pub async fn set_workspace(&self, path: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct WsResult { verdict: String, audit_ref: String }

        let res: WsResult = self.client.call("set_workspace", json!({"path": path})).await?;
        Ok(res.audit_ref)
    }
}
