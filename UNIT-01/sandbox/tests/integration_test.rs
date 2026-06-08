use std::path::PathBuf;

#[test]
fn test_excluded_command_error_via_spawn() {
    let result = sandbox::cage::sandbox::spawn_sandboxed_command(
        "docker",
        &["ps".to_string()],
        &PathBuf::from("/tmp"),
        sandbox::cage::sandbox::SandboxOptions::default(),
        true,
    );
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("docker"), "error should mention docker: {}", err);
    assert!(err.contains("excluded"), "error should mention excluded: {}", err);
}

/// Test secrets scrubbing integration end-to-end.
#[test]
fn test_secrets_scrubbing_aws_key() {
    let input_stdout = "export AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE";
    let input_stderr = "";
    let (scrubbed_stdout, scrubbed_stderr, was_scrubbed) =
        sandbox::secrets::scrub_output(input_stdout, input_stderr);
    assert!(was_scrubbed, "AWS key should be detected");
    assert!(
        scrubbed_stdout.contains("REDACTED"),
        "AWS key should be redacted: {}",
        scrubbed_stdout
    );
    assert_eq!(scrubbed_stderr, "");
}

/// Test secrets scrubbing with GitHub token.
#[test]
fn test_secrets_scrubbing_github_token() {
    let input = "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789abcd";
    let (scrubbed, _stderr, was_scrubbed) = sandbox::secrets::scrub_output(input, "");
    assert!(was_scrubbed, "GitHub token should be detected");
    assert!(scrubbed.contains("REDACTED GitHub Token"), "should redact GitHub token");
}

/// Test that normal command output is not scrubbed.
#[test]
fn test_secrets_no_false_positive() {
    let input = "hello world, this is a normal build log";
    let (scrubbed, _stderr, was_scrubbed) = sandbox::secrets::scrub_output(input, "");
    assert!(!was_scrubbed, "normal output should not be scrubbed");
    assert_eq!(scrubbed, input);
}

/// Test that AWS secret key assignment is scrubbed.
#[test]
fn test_secrets_scrubbing_aws_secret_key() {
    let input = r#"aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY""#;
    let (scrubbed, _, was_scrubbed) = sandbox::secrets::scrub_output(input, "");
    assert!(was_scrubbed);
    assert!(scrubbed.contains("REDACTED AWS Secret Key"));
}

/// Test full sandbox lifecycle: spawn, execute, output collection.
#[test]
fn test_sandbox_lifecycle() {
    let workspace = std::env::temp_dir().join("sandbox_int_test_lifecycle");
    let _ = std::fs::remove_dir_all(&workspace);
    std::fs::create_dir_all(&workspace).unwrap();

    let opts = sandbox::cage::sandbox::SandboxOptions {
        excluded_commands: vec![],
        ..Default::default()
    };

    let child = sandbox::cage::sandbox::spawn_sandboxed_command(
        "sh",
        &["-c".to_string(), "echo hello_from_sandbox".to_string()],
        &workspace,
        opts,
        true,
    )
    .unwrap();

    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("hello_from_sandbox"));

    let _ = std::fs::remove_dir_all(&workspace);
}

/// Test that temp isolation creates unique directories per invocation.
#[test]
fn test_temp_isolation_unique_dirs() {
    let opts = sandbox::cage::sandbox::SandboxOptions {
        excluded_commands: vec![],
        ..Default::default()
    };
    let workspace = std::env::temp_dir().join("sandbox_int_test_temp_uniq");
    let _ = std::fs::remove_dir_all(&workspace);
    std::fs::create_dir_all(&workspace).unwrap();

    let child1 = sandbox::cage::sandbox::spawn_sandboxed_command(
        "echo", &["a".to_string()], &workspace, opts.clone(), true,
    )
    .unwrap();
    let td1 = child1.temp_dir().cloned().unwrap();

    let child2 = sandbox::cage::sandbox::spawn_sandboxed_command(
        "echo", &["b".to_string()], &workspace, opts.clone(), true,
    )
    .unwrap();
    let td2 = child2.temp_dir().cloned().unwrap();

    assert_ne!(td1, td2, "each sandboxed process gets a unique temp dir");

    drop(child1);
    drop(child2);
    let _ = std::fs::remove_dir_all(&workspace);
}
