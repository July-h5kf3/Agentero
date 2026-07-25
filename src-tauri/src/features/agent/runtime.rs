use crate::core::error::AppError;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::watch;

/// In-memory controls for active one-shot ACP sessions.
///
/// ACP connections are intentionally short-lived today, so cancellation state is
/// runtime-only and is removed as soon as the corresponding session finishes.
pub struct AgentRunController {
    cancellations: Mutex<HashMap<String, watch::Sender<bool>>>,
}

impl AgentRunController {
    pub fn new() -> Self {
        Self {
            cancellations: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, session_id: &str) -> Result<watch::Receiver<bool>, AppError> {
        let (sender, receiver) = watch::channel(false);
        let mut cancellations = self
            .cancellations
            .lock()
            .map_err(|_| AppError::message("agent run controller lock poisoned"))?;
        if cancellations.contains_key(session_id) {
            return Err(AppError::message("agent run is already active"));
        }
        cancellations.insert(session_id.to_string(), sender);
        Ok(receiver)
    }

    pub fn cancel(&self, session_id: &str) -> Result<(), AppError> {
        let sender = self
            .cancellations
            .lock()
            .map_err(|_| AppError::message("agent run controller lock poisoned"))?
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::message("agent run is no longer active"))?;
        sender.send_replace(true);
        Ok(())
    }

    pub fn finish(&self, session_id: &str) -> Result<(), AppError> {
        self.cancellations
            .lock()
            .map_err(|_| AppError::message("agent run controller lock poisoned"))?
            .remove(session_id);
        Ok(())
    }
}

impl Default for AgentRunController {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::AgentRunController;

    #[test]
    fn cancellation_is_signalled_only_while_the_run_is_registered() {
        let controller = AgentRunController::new();
        let receiver = controller.register("session-1").expect("register run");

        controller.cancel("session-1").expect("cancel run");
        assert!(*receiver.borrow());

        controller.finish("session-1").expect("finish run");
        assert!(controller.cancel("session-1").is_err());
    }

    #[test]
    fn duplicate_registration_does_not_replace_the_active_run() {
        let controller = AgentRunController::new();
        let receiver = controller.register("session-1").expect("register run");

        assert!(controller.register("session-1").is_err());
        controller.cancel("session-1").expect("cancel original run");
        assert!(*receiver.borrow());
    }
}
