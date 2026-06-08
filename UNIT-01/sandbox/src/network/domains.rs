use std::collections::HashMap;

static ECOSYSTEM_DOMAINS: &[(&str, &[&str])] = &[
    ("node", &[
        "registry.npmjs.org",
        "*.npmjs.org",
        "yarnpkg.com",
        "bun.sh",
    ]),
    ("python", &[
        "pypi.org",
        "files.pythonhosted.org",
        "pythonhosted.org",
    ]),
    ("rust", &[
        "crates.io",
        "index.crates.io",
        "static.crates.io",
        "static.rust-lang.org",
        "sh.rustup.rs",
    ]),
    ("go", &[
        "proxy.golang.org",
        "sum.golang.org",
        "*.googlesource.com",
    ]),
    ("ruby", &[
        "rubygems.org",
        "*.rubygems.org",
    ]),
    ("java", &[
        "repo1.maven.org",
        "jcenter.bintray.com",
        "download.jetbrains.com",
        "plugins.gradle.org",
    ]),
    ("dotnet", &[
        "api.nuget.org",
        "nuget.org",
    ]),
    ("php", &[
        "packagist.org",
        "getcomposer.org",
    ]),
    ("elixir", &[
        "hex.pm",
    ]),
    ("dart", &[
        "pub.dev",
        "storage.googleapis.com",
    ]),
    ("haskell", &[
        "hackage.haskell.org",
    ]),
    ("ocaml", &[
        "opam.ocaml.org",
    ]),
    ("lua", &[
        "luarocks.org",
    ]),
    ("perl", &[
        "cpan.org",
        "metacpan.org",
    ]),
    ("clojure", &[
        "clojars.org",
    ]),
    ("julia", &[
        "pkg.julialang.org",
        "storage.julialang.net",
    ]),
    ("swift", &[
        "swift.org",
        "cocoapods.org",
    ]),
    ("zig", &[
        "ziglang.org",
    ]),
    ("latex", &[
        "packages.miktex.org",
        "ctan.org",
    ]),
    ("containers", &[
        "registry.hub.docker.com",
        "ghcr.io",
        "quay.io",
        "gcr.io",
        "mcr.microsoft.com",
    ]),
    ("github", &[
        "github.com",
        "api.github.com",
        "raw.githubusercontent.com",
        "docs.github.com",
        "github.blog",
    ]),
    ("brew", &[
        "raw.githubusercontent.com",
        "ghcr.io",
        "formulae.brew.sh",
    ]),
    ("linux-distros", &[
        "archive.ubuntu.com",
        "security.ubuntu.com",
        "packages.debian.org",
        "dl-cdn.alpinelinux.org",
        "dl.fedoraproject.org",
    ]),
    ("playwright", &[
        "*.google.com",
        "*.googleapis.com",
        "*.gvt1.com",
    ]),
    ("terraform", &[
        "releases.hashicorp.com",
        "registry.terraform.io",
    ]),
    ("deno", &[
        "deno.land",
        "jsr.io",
    ]),
    ("bazel", &[
        "releases.bazel.build",
        "bcr.bazel.build",
    ]),
    ("infra", &[
        "api.anthropic.com",
        "claude.ai",
        "platform.claude.com",
        "openai.com",
        "api.openai.com",
        "api.groq.com",
        "api.fireworks.ai",
    ]),
];

/// Resolve ecosystem identifiers and/or raw domains into a flat domain list.
/// Accepts identifiers like "node", "python", "rust" or raw domains like "example.com".
/// Wildcard patterns like "*.npmjs.org" are preserved as-is.
pub fn resolve(allowed: &[String]) -> Vec<String> {
    let map: HashMap<&str, &[&str]> = ECOSYSTEM_DOMAINS.iter().map(|(k, v)| (*k, *v)).collect();
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for entry in allowed {
        let key = entry.to_lowercase();
        if let Some(domains) = map.get(key.as_str()) {
            for d in *domains {
                if seen.insert(d.to_string()) {
                    result.push(d.to_string());
                }
            }
        } else {
            if seen.insert(key.clone()) {
                result.push(key);
            }
        }
    }

    result
}

pub fn default_allowed() -> Vec<String> {
    resolve(&[
        "node".into(),
        "python".into(),
        "rust".into(),
        "go".into(),
        "github".into(),
        "brew".into(),
    ])
}

pub fn check_domain(host: &str, allowed_domains: &[String]) -> bool {
    let host = host.trim().to_lowercase();
    let host = host.split(':').next().unwrap_or(&host);

    for pattern in allowed_domains {
        let p = pattern.to_lowercase();
        if p.starts_with("*.") {
            let suffix = &p[1..];
            if host.ends_with(suffix) {
                return true;
            }
        } else if host == p {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_ecosystem() {
        let domains = resolve(&["node".into()]);
        assert!(domains.contains(&"registry.npmjs.org".to_string()));
        assert!(domains.contains(&"*.npmjs.org".to_string()));
    }

    #[test]
    fn test_resolve_raw_domain() {
        let domains = resolve(&["example.com".into()]);
        assert!(domains.contains(&"example.com".to_string()));
    }

    #[test]
    fn test_resolve_multiple() {
        let domains = resolve(&["node".into(), "python".into()]);
        assert!(domains.contains(&"pypi.org".to_string()));
        assert!(domains.contains(&"registry.npmjs.org".to_string()));
    }

    #[test]
    fn test_default_allowed() {
        let domains = default_allowed();
        assert!(domains.contains(&"registry.npmjs.org".to_string()));
        assert!(domains.contains(&"pypi.org".to_string()));
        assert!(domains.contains(&"crates.io".to_string()));
        assert!(domains.contains(&"github.com".to_string()));
    }

    #[test]
    fn test_check_domain_exact() {
        let list = vec!["github.com".to_string()];
        assert!(check_domain("github.com", &list));
        assert!(!check_domain("evil.com", &list));
    }

    #[test]
    fn test_check_domain_wildcard() {
        let list = vec!["*.npmjs.org".to_string()];
        assert!(check_domain("registry.npmjs.org", &list));
        assert!(!check_domain("npmjs.org", &list));
        assert!(!check_domain("npmjs.com", &list));
    }

    #[test]
    fn test_check_domain_apex_and_sub() {
        let list = vec!["*.npmjs.org".to_string(), "npmjs.org".to_string()];
        assert!(check_domain("registry.npmjs.org", &list));
        assert!(check_domain("npmjs.org", &list));
    }

    #[test]
    fn test_check_domain_with_port() {
        let list = vec!["github.com".to_string()];
        assert!(check_domain("github.com:443", &list));
    }

}
