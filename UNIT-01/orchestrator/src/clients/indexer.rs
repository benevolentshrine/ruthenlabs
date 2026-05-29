use super::uds::UDSClient;
use serde::Deserialize;
use serde_json::json;

pub struct IndexerClient {
    client: UDSClient,
}

impl IndexerClient {
    pub fn new() -> Self {
        Self {
            client: UDSClient::new("/tmp/ruthen/indexer.sock"),
        }
    }

    fn auth_params() -> serde_json::Value {
        json!({"token": "uds-internal-trust"})
    }

    fn merge(mut base: serde_json::Value, extra: serde_json::Value) -> serde_json::Value {
        if let (Some(b), Some(e)) = (base.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                b.insert(k.clone(), v.clone());
            }
        }
        base
    }

    pub async fn search(&self, query: &str) -> Result<Vec<FileRecord>, String> {
        #[derive(Deserialize)]
        struct SearchWrapper(Vec<FileRecord>);

        let p = Self::merge(json!({"query": query}), Self::auth_params());
        let res: Vec<FileRecord> = self.client.call("search", p).await?;
        Ok(res)
    }

    pub async fn read(&self, path: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct ReadResult {
            content: String,
        }

        let res: ReadResult = self
            .client
            .call(
                "read",
                Self::merge(json!({"path": path}), Self::auth_params()),
            )
            .await?;
        Ok(res.content)
    }

    pub async fn list(&self, path: &str) -> Result<ListResult, String> {
        let res: ListResult = self
            .client
            .call(
                "ls",
                Self::merge(json!({"path": path}), Self::auth_params()),
            )
            .await?;
        Ok(res)
    }

    pub async fn write(&self, path: &str, content: &str) -> Result<(), String> {
        self.client
            .call::<serde_json::Value>(
                "write",
                Self::merge(
                    json!({"path": path, "content": content}),
                    Self::auth_params(),
                ),
            )
            .await?;
        Ok(())
    }

    pub async fn patch(
        &self,
        path: &str,
        target: &str,
        replacement: &str,
    ) -> Result<String, String> {
        #[derive(Deserialize)]
        struct PatchResult {
            status: String,
        }
        let res: PatchResult = self
            .client
            .call(
                "patch",
                Self::merge(
                    json!({"path": path, "target": target, "replacement": replacement}),
                    Self::auth_params(),
                ),
            )
            .await?;
        Ok(res.status)
    }

    pub async fn delete(&self, path: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct DeleteResult {
            status: String,
        }
        let res: DeleteResult = self
            .client
            .call(
                "delete",
                Self::merge(json!({"path": path}), Self::auth_params()),
            )
            .await?;
        Ok(res.status)
    }

    pub async fn rollback(&self) -> Result<String, String> {
        #[derive(Deserialize)]
        struct RbResult {
            status: String,
        }
        let res: RbResult = self
            .client
            .call("rollback", Self::merge(json!({}), Self::auth_params()))
            .await?;
        Ok(res.status)
    }

    pub async fn get_project_map(&self, path: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct MapResult {
            map: String,
        }
        let res: MapResult = self
            .client
            .call(
                "project_map",
                Self::merge(json!({"path": path}), Self::auth_params()),
            )
            .await?;
        Ok(res.map)
    }

    pub async fn glob(&self, pattern: &str, base: &str) -> Result<Vec<String>, String> {
        #[derive(Deserialize)]
        struct GlobResult {
            files: Vec<String>,
        }
        let res: GlobResult = self
            .client
            .call(
                "glob",
                Self::merge(
                    json!({"pattern": pattern, "base": base}),
                    Self::auth_params(),
                ),
            )
            .await?;
        Ok(res.files)
    }

    pub async fn find(&self, name: &str, root: &str) -> Result<Vec<String>, String> {
        #[derive(Deserialize)]
        struct FindResult {
            files: Vec<String>,
        }
        let res: FindResult = self
            .client
            .call(
                "find",
                Self::merge(json!({"name": name, "root": root}), Self::auth_params()),
            )
            .await?;
        Ok(res.files)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileRecord {
    pub path: String,
    #[serde(default)]
    pub relative_path: String,
    #[serde(default)]
    pub language: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListResult {
    pub entries: Vec<ListEntry>,
}
