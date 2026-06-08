use regex::Regex;
use std::sync::OnceLock;

struct SecretPattern {
    regex: Regex,
    label: &'static str,
}

fn get_patterns() -> &'static [SecretPattern] {
    static PATTERNS: OnceLock<Vec<SecretPattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            SecretPattern {
                regex: Regex::new(r"AKIA[0-9A-Z]{16}").unwrap(),
                label: "AWS Access Key",
            },
            SecretPattern {
                regex: Regex::new(r#"(?i)aws.{0,30}['\"][0-9a-zA-Z\/+]{40}['\"]"#).unwrap(),
                label: "AWS Secret Key",
            },
            SecretPattern {
                regex: Regex::new(r"gh[pousr]_[0-9a-zA-Z]{36}").unwrap(),
                label: "GitHub Token",
            },
            SecretPattern {
                regex: Regex::new(r"npm_[a-zA-Z0-9]{36}").unwrap(),
                label: "npm Token",
            },
            SecretPattern {
                regex: Regex::new(r"xox[baprs]-[0-9a-zA-Z-]{10,50}").unwrap(),
                label: "Slack Token",
            },
            SecretPattern {
                regex: Regex::new(r"(?i)(?:Authorization|authorization):\s*Bearer\s+[a-zA-Z0-9._-]{20,}")
                    .unwrap(),
                label: "Bearer Token",
            },
            SecretPattern {
                regex: Regex::new(
                    r"(?s)-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----.+?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
                )
                .unwrap(),
                label: "SSH Private Key",
            },
            SecretPattern {
                regex: Regex::new(
                    r"eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+",
                )
                .unwrap(),
                label: "JWT Token",
            },
            SecretPattern {
                regex: Regex::new(
                    r#"(?i)(?:api[_-]?key|secret|password|token|auth)[=:]\s*['\"][^\s'"]{16,}['"]"#,
                )
                .unwrap(),
                label: "Generic Credential",
            },
            SecretPattern {
                regex: Regex::new(r"(?i)(?:api_key|api-key|secret|token)=[^&\s]{16,}").unwrap(),
                label: "API Key in URL",
            },
        ]
    })
}

pub fn scrub(input: &str) -> String {
    let mut result = input.to_string();
    for pattern in get_patterns().iter() {
        result = pattern
            .regex
            .replace_all(&result, format!("[REDACTED {}]", pattern.label))
            .to_string();
    }
    result
}

pub fn scrub_output(stdout: &str, stderr: &str) -> (String, String, bool) {
    let scrubbed_stdout = scrub(stdout);
    let scrubbed_stderr = scrub(stderr);
    let was_scrubbed = scrubbed_stdout != stdout || scrubbed_stderr != stderr;
    (scrubbed_stdout, scrubbed_stderr, was_scrubbed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scrub_aws_key() {
        let result = scrub("AKIAIOSFODNN7EXAMPLE");
        assert!(result.contains("REDACTED AWS Access Key"));
    }

    #[test]
    fn test_scrub_aws_secret() {
        let result = scrub(
            r#"aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY""#,
        );
        assert!(result.contains("REDACTED AWS Secret Key"));
    }

    #[test]
    fn test_scrub_github_token() {
        let result = scrub("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert!(result.contains("REDACTED GitHub Token"));
    }

    #[test]
    fn test_scrub_npm_token() {
        let result = scrub("npm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert!(result.contains("REDACTED npm Token"));
    }

    #[test]
    fn test_scrub_ssh_key_block() {
        let result = scrub(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nsomething\n-----END OPENSSH PRIVATE KEY-----",
        );
        assert!(result.contains("REDACTED SSH Private Key"));
    }

    #[test]
    fn test_scrub_jwt() {
        let result = scrub(
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3j4vNZK3L5g",
        );
        assert!(result.contains("REDACTED JWT Token"));
    }

    #[test]
    fn test_scrub_output_combined() {
        let (so, se, scrubbed) = scrub_output("hello AKIAIOSFODNN7EXAMPLE", "world");
        assert!(so.contains("REDACTED"));
        assert!(!se.contains("REDACTED"));
        assert!(scrubbed);
    }

    #[test]
    fn test_no_false_positive() {
        let result = scrub("hello world, this is completely normal output");
        assert_eq!(result, "hello world, this is completely normal output");
    }

    #[test]
    fn test_no_false_positive_short_string() {
        let result = scrub(r#"password = "short""#);
        assert_eq!(result, r#"password = "short""#);
    }

    #[test]
    fn test_scrub_output_no_secrets() {
        let (so, se, scrubbed) = scrub_output("hello", "world");
        assert!(!scrubbed);
        assert_eq!(so, "hello");
        assert_eq!(se, "world");
    }
}
