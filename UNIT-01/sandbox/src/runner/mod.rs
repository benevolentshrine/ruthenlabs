//! SANDBOX Runners (Open-Core)
//!
//! Execution strategies:
//! - InterpreterRunner: Landlock + Seccomp + Cgroups for interpreted languages
//! - BinaryRunner: seccomp + namespaces for native binaries
//! - HeuristicRunner: content analysis for unknown files

use crate::cage::policy::SecurityMode;
use crate::classifier::magic::FileClass;
use crate::classifier::ClassificationResult;
use anyhow::Result;
use std::path::Path;

pub mod binary;
pub mod heuristic;
pub mod interpreter;

#[derive(Debug, Clone)]
pub enum RunnerVerdict {
    Success { output: String },
    Blocked { reason: String },
    Timeout,
    Unsupported { reason: String },
}

pub trait Runner {
    fn can_handle(&self, class: &FileClass) -> bool;
    fn execute(
        &self,
        path: &Path,
        classification: &ClassificationResult,
        mode: SecurityMode,
    ) -> Result<RunnerVerdict>;
    fn check_dependencies(&self) -> Vec<DependencyStatus>;
}

#[derive(Debug, Clone)]
pub struct DependencyStatus {
    pub name: String,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

pub struct RunnerRouter {
    interpreter: interpreter::InterpreterRunner,
    binary: binary::BinaryRunner,
    heuristic: heuristic::HeuristicRunner,
}

impl RunnerRouter {
    pub fn new() -> Self {
        Self {
            interpreter: interpreter::InterpreterRunner::new(),
            binary: binary::BinaryRunner::new(),
            heuristic: heuristic::HeuristicRunner::new(),
        }
    }

    pub fn route(
        &self,
        path: &Path,
        classification: &ClassificationResult,
        mode: SecurityMode,
    ) -> Result<RunnerVerdict> {
        let class = &classification.class;
        use crate::classifier::magic::is_interpreted;

        let runner: &dyn Runner = if class == &FileClass::Binary {
            &self.binary
        } else if is_interpreted(class) {
            &self.interpreter
        } else {
            &self.heuristic
        };

        runner.execute(path, classification, mode)
    }

    pub fn check_all_dependencies(&self) -> Vec<(&str, Vec<DependencyStatus>)> {
        vec![
            ("interpreter", self.interpreter.check_dependencies()),
            ("binary", self.binary.check_dependencies()),
        ]
    }
}

impl Default for RunnerRouter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runner_verdict_variants() {
        let success = RunnerVerdict::Success {
            output: "test".to_string(),
        };
        assert!(matches!(success, RunnerVerdict::Success { .. }));
        let blocked = RunnerVerdict::Blocked {
            reason: "test".to_string(),
        };
        assert!(matches!(blocked, RunnerVerdict::Blocked { .. }));
    }
}
