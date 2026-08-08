//! Interactive ACP form elicitation (`elicitation/create`).
//!
//! Codex Plan-mode `request_user_input` is bridged by codex-acp as form
//! elicitation. The Host must advertise `clientCapabilities.elicitation.form`
//! and answer `elicitation/create` or the adapter returns empty answers.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

/// User decision for a pending elicitation.
#[derive(Debug, Clone)]
pub enum ElicitationAnswer {
    /// Accept with field values (property id → string content).
    Accept(BTreeMap<String, String>),
    Decline,
    Cancel,
}

/// Process-wide table of elicitation requests awaiting a user decision.
#[derive(Clone, Default)]
pub struct ElicitationGate {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<ElicitationAnswer>>>>,
}

impl ElicitationGate {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register(&self, request_id: &str) -> oneshot::Receiver<ElicitationAnswer> {
        let (tx, rx) = oneshot::channel();
        if let Ok(mut g) = self.pending.lock() {
            g.insert(request_id.to_string(), tx);
        }
        rx
    }

    pub fn resolve(&self, request_id: &str, answer: ElicitationAnswer) -> bool {
        let tx = self
            .pending
            .lock()
            .ok()
            .and_then(|mut g| g.remove(request_id));
        match tx {
            Some(tx) => tx.send(answer).is_ok(),
            None => false,
        }
    }
}
