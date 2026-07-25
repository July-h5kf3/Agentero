use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

static CANCELLED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn cancel(task_id: &str) {
    if let Ok(mut tasks) = CANCELLED.lock() {
        tasks.insert(task_id.to_string());
    }
}

pub fn is_cancelled(task_id: &str) -> bool {
    CANCELLED
        .lock()
        .map(|tasks| tasks.contains(task_id))
        .unwrap_or(false)
}

pub fn finish(task_id: &str) {
    if let Ok(mut tasks) = CANCELLED.lock() {
        tasks.remove(task_id);
    }
}
