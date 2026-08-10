pub mod commands;

use crate::core::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

pub const JOB_CHANGED_EVENT: &str = "job:changed";

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct JobId(pub String);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum JobKind {
    ParseRefs,
    ParseBody,
    LayoutAnalyze,
    LayoutTranslate,
    DownloadAssets,
    PageCount,
    WikiReindex,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "camelCase")]
pub enum JobLane {
    Focus,
    #[default]
    Normal,
    Idle,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Skipped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DepPolicy {
    AllSettled,
    AllSucceeded,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub id: String,
    pub kind: JobKind,
    pub lane: JobLane,
    pub state: JobState,
    pub vault_path: String,
    pub paper_path: Option<String>,
    pub fingerprint: String,
    pub depends_on: Vec<String>,
    pub dep_policy: DepPolicy,
    pub progress: Option<f32>,
    pub phase: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobChangedPayload {
    pub job: JobSnapshot,
}

#[derive(Debug, Clone)]
struct Job {
    id: JobId,
    kind: JobKind,
    lane: JobLane,
    vault_path: PathBuf,
    paper_path: Option<String>,
    fingerprint: String,
    depends_on: Vec<JobId>,
    dep_policy: DepPolicy,
    attempts: u8,
    state: JobState,
    progress: Option<f32>,
    phase: Option<String>,
    error: Option<String>,
    force: bool,
}

impl Job {
    fn snapshot(&self) -> JobSnapshot {
        JobSnapshot {
            id: self.id.0.clone(),
            kind: self.kind,
            lane: self.lane,
            state: self.state,
            vault_path: self.vault_path.to_string_lossy().to_string(),
            paper_path: self.paper_path.clone(),
            fingerprint: self.fingerprint.clone(),
            depends_on: self.depends_on.iter().map(|id| id.0.clone()).collect(),
            dep_policy: self.dep_policy,
            progress: self.progress,
            phase: self.phase.clone(),
            error: self.error.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct JobKey {
    kind: JobKind,
    vault_path: PathBuf,
    paper_path: Option<String>,
    fingerprint: String,
}

#[derive(Debug, Default)]
struct LaneQueues {
    focus: VecDeque<JobId>,
    normal: VecDeque<JobId>,
    idle: VecDeque<JobId>,
}

impl LaneQueues {
    fn push(&mut self, lane: JobLane, id: JobId) {
        self.queue_mut(lane).push_back(id);
    }

    fn promote_to_focus(&mut self, id: &JobId) {
        self.remove(id);
        self.focus.push_back(id.clone());
    }

    fn remove(&mut self, id: &JobId) {
        for queue in [&mut self.focus, &mut self.normal, &mut self.idle] {
            if let Some(index) = queue.iter().position(|candidate| candidate == id) {
                queue.remove(index);
                return;
            }
        }
    }

    #[cfg(test)]
    fn next_eligible(&self) -> Option<JobId> {
        self.focus
            .front()
            .or_else(|| self.normal.front())
            .or_else(|| self.idle.front())
            .cloned()
    }

    fn queue_mut(&mut self, lane: JobLane) -> &mut VecDeque<JobId> {
        match lane {
            JobLane::Focus => &mut self.focus,
            JobLane::Normal => &mut self.normal,
            JobLane::Idle => &mut self.idle,
        }
    }
}

#[derive(Debug, Default)]
struct JobCenterInner {
    jobs: HashMap<JobId, Job>,
    active_keys: HashMap<JobKey, JobId>,
    lanes: LaneQueues,
}

#[derive(Clone, Debug)]
pub struct JobCenter {
    inner: Arc<Mutex<JobCenterInner>>,
}

impl JobCenter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(JobCenterInner::default())),
        }
    }

    pub fn handle(&self) -> Self {
        self.clone()
    }

    pub async fn enqueue_parse_refs(
        &self,
        vault: impl Into<PathBuf>,
        path: impl Into<String>,
        lane: JobLane,
        force: bool,
    ) -> JobSnapshot {
        let vault_path = normalize_vault_path(vault.into());
        let paper_path = path.into();
        let fingerprint = format!("parseRefs:v1:online:true:force:{force}");
        let key = JobKey {
            kind: JobKind::ParseRefs,
            vault_path: vault_path.clone(),
            paper_path: Some(paper_path.clone()),
            fingerprint: fingerprint.clone(),
        };

        let mut inner = self.inner.lock().await;
        if let Some(existing_id) = inner.active_keys.get(&key) {
            if let Some(existing) = inner.jobs.get(existing_id) {
                return existing.snapshot();
            }
        }

        let id = JobId(uuid::Uuid::new_v4().to_string());
        let job = Job {
            id: id.clone(),
            kind: JobKind::ParseRefs,
            lane,
            vault_path,
            paper_path: Some(paper_path),
            fingerprint,
            depends_on: Vec::new(),
            dep_policy: DepPolicy::AllSucceeded,
            attempts: 0,
            state: JobState::Queued,
            progress: Some(0.0),
            phase: Some("queued".into()),
            error: None,
            force,
        };
        let snapshot = job.snapshot();
        inner.active_keys.insert(key, id.clone());
        inner.lanes.push(lane, id.clone());
        inner.jobs.insert(id, job);
        snapshot
    }

    pub async fn enqueue_parse_body(
        &self,
        vault: impl Into<PathBuf>,
        path: impl Into<String>,
        lane: JobLane,
        force: bool,
    ) -> JobSnapshot {
        let vault_path = normalize_vault_path(vault.into());
        let paper_path = path.into();
        let fingerprint = format!("parseBody:v1:force:{force}");
        let key = JobKey {
            kind: JobKind::ParseBody,
            vault_path: vault_path.clone(),
            paper_path: Some(paper_path.clone()),
            fingerprint: fingerprint.clone(),
        };

        let mut inner = self.inner.lock().await;
        if let Some(existing_id) = inner.active_keys.get(&key) {
            if let Some(existing) = inner.jobs.get(existing_id) {
                return existing.snapshot();
            }
        }

        let id = JobId(uuid::Uuid::new_v4().to_string());
        let job = Job {
            id: id.clone(),
            kind: JobKind::ParseBody,
            lane,
            vault_path,
            paper_path: Some(paper_path),
            fingerprint,
            depends_on: Vec::new(),
            dep_policy: DepPolicy::AllSucceeded,
            attempts: 0,
            state: JobState::Queued,
            progress: Some(0.0),
            phase: Some("queued".into()),
            error: None,
            force,
        };
        let snapshot = job.snapshot();
        inner.active_keys.insert(key, id.clone());
        inner.lanes.push(lane, id.clone());
        inner.jobs.insert(id, job);
        snapshot
    }

    pub async fn promote_paper(&self, vault: &Path, path: &str) -> Vec<JobSnapshot> {
        let vault = normalize_vault_path(vault.to_path_buf());
        let mut snapshots = Vec::new();
        let mut inner = self.inner.lock().await;
        let ids: Vec<JobId> = inner
            .jobs
            .iter()
            .filter(|(_, job)| {
                job.state == JobState::Queued
                    && job.vault_path == vault
                    && job.paper_path.as_deref() == Some(path)
            })
            .map(|(id, _)| id.clone())
            .collect();

        for id in ids {
            if let Some(job) = inner.jobs.get_mut(&id) {
                job.lane = JobLane::Focus;
                snapshots.push(job.snapshot());
            }
            inner.lanes.promote_to_focus(&id);
        }
        snapshots
    }

    pub async fn cancel(&self, job_id: &str) -> bool {
        let mut inner = self.inner.lock().await;
        let id = JobId(job_id.to_string());
        let Some(job) = inner.jobs.get_mut(&id) else {
            return false;
        };
        if job.state != JobState::Queued {
            return false;
        }
        job.state = JobState::Cancelled;
        job.progress = None;
        job.phase = Some("cancelled".into());
        inner.lanes.remove(&id);
        release_active_key(&mut inner, &id);
        true
    }

    pub async fn list(&self, vault: Option<&Path>, path: Option<&str>) -> Vec<JobSnapshot> {
        let vault = vault.map(|vault| normalize_vault_path(vault.to_path_buf()));
        let inner = self.inner.lock().await;
        inner
            .jobs
            .values()
            .filter(|job| {
                vault.as_ref().is_none_or(|vault| &job.vault_path == vault)
                    && path.is_none_or(|path| job.paper_path.as_deref() == Some(path))
            })
            .map(Job::snapshot)
            .collect()
    }

    pub async fn run_parse_refs_job(self, app: tauri::AppHandle, job_id: String) {
        let started = self.mark_running(&job_id).await;
        let Some((snapshot, vault, path, force)) = started else {
            return;
        };
        emit_job_changed(&app, snapshot);

        let result = crate::features::refs::parse_paper_refs(&vault, &path, true, force).await;
        let snapshot = match result {
            Ok(_) => {
                self.finish(
                    &job_id,
                    JobState::Succeeded,
                    Some(100.0),
                    Some("completed"),
                    None,
                )
                .await
            }
            Err(e) => {
                self.finish(
                    &job_id,
                    JobState::Failed,
                    None,
                    Some("failed"),
                    Some(e.to_string()),
                )
                .await
            }
        };
        if let Some(snapshot) = snapshot {
            emit_job_changed(&app, snapshot);
        }
    }

    pub async fn run_parse_body_job(self, app: tauri::AppHandle, job_id: String) {
        let started = self.mark_running(&job_id).await;
        let Some((snapshot, vault, path, force)) = started else {
            return;
        };
        emit_job_changed(&app, snapshot);

        let result = crate::features::import::pdf_parse::parse_paper_body(
            crate::features::import::pdf_parse::PaperParseBodyArgs {
                vault_path: vault.to_string_lossy().to_string(),
                path,
                force,
                task_id: Some(job_id.clone()),
            },
        )
        .await;
        let snapshot = match result {
            Ok(_) => {
                crate::features::agent::background_tasks::finish(&job_id);
                self.finish(
                    &job_id,
                    JobState::Succeeded,
                    Some(100.0),
                    Some("completed"),
                    None,
                )
                .await
            }
            Err(e) => {
                crate::features::agent::background_tasks::finish(&job_id);
                self.finish(
                    &job_id,
                    JobState::Failed,
                    None,
                    Some("failed"),
                    Some(e.to_string()),
                )
                .await
            }
        };
        if let Some(snapshot) = snapshot {
            emit_job_changed(&app, snapshot);
        }
    }

    async fn mark_running(&self, job_id: &str) -> Option<(JobSnapshot, PathBuf, String, bool)> {
        let mut inner = self.inner.lock().await;
        let id = JobId(job_id.to_string());
        let job = inner.jobs.get_mut(&id)?;
        if job.state != JobState::Queued {
            return None;
        }
        job.state = JobState::Running;
        job.attempts = job.attempts.saturating_add(1);
        job.progress = None;
        job.phase = Some("running".into());
        let snapshot = job.snapshot();
        let vault_path = job.vault_path.clone();
        let paper_path = job.paper_path.clone()?;
        let force = job.force;
        inner.lanes.remove(&id);
        Some((snapshot, vault_path, paper_path, force))
    }

    async fn finish(
        &self,
        job_id: &str,
        state: JobState,
        progress: Option<f32>,
        phase: Option<&str>,
        error: Option<String>,
    ) -> Option<JobSnapshot> {
        let mut inner = self.inner.lock().await;
        let id = JobId(job_id.to_string());
        let job = inner.jobs.get_mut(&id)?;
        job.state = state;
        job.progress = progress;
        job.phase = phase.map(str::to_string);
        job.error = error;
        let snapshot = job.snapshot();
        release_active_key(&mut inner, &id);
        Some(snapshot)
    }

    #[cfg(test)]
    async fn mark_succeeded_for_test(&self, job_id: &str) {
        self.finish(
            job_id,
            JobState::Succeeded,
            Some(100.0),
            Some("completed"),
            None,
        )
        .await;
    }

    #[cfg(test)]
    async fn next_queued_for_test(&self) -> Option<String> {
        self.inner.lock().await.lanes.next_eligible().map(|id| id.0)
    }
}

impl Default for JobCenter {
    fn default() -> Self {
        Self::new()
    }
}

pub fn emit_job_changed(app: &tauri::AppHandle, job: JobSnapshot) {
    let _ = app.emit(JOB_CHANGED_EVENT, JobChangedPayload { job });
}

pub fn parse_lane(lane: Option<JobLane>) -> JobLane {
    lane.unwrap_or_default()
}

pub fn validate_job_paper(vault_path: &str, path_raw: &str) -> Result<(PathBuf, String), AppError> {
    let vault = PathBuf::from(vault_path.trim());
    if !vault.is_dir() {
        return Err(AppError::message("vault path is not a directory"));
    }
    let path = crate::core::fs::sanitize_vault_rel(path_raw.trim())
        .map_err(|_| AppError::message("invalid paper path"))?;
    if path.is_empty() {
        return Err(AppError::message("path is required"));
    }
    let paper_dir = vault.join(&path);
    if !paper_dir.is_dir() {
        return Err(AppError::message("paper folder not found"));
    }
    Ok((vault, path))
}

fn release_active_key(inner: &mut JobCenterInner, job_id: &JobId) {
    inner.active_keys.retain(|_, id| id != job_id);
}

fn normalize_vault_path(path: PathBuf) -> PathBuf {
    std::fs::canonicalize(&path).unwrap_or(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        PathBuf::from(format!("/tmp/agentero-job-center-{name}"))
    }

    #[tokio::test]
    async fn enqueue_dedupes_active_job() {
        let center = JobCenter::new();
        let first = center
            .enqueue_parse_refs(vault("dedupe"), "papers/a", JobLane::Normal, false)
            .await;
        let duplicate = center
            .enqueue_parse_refs(vault("dedupe"), "papers/a", JobLane::Normal, false)
            .await;

        assert_eq!(first.id, duplicate.id);
        assert_eq!(center.list(None, None).await.len(), 1);
    }

    #[tokio::test]
    async fn enqueue_dedupes_active_parse_body_job() {
        let center = JobCenter::new();
        let first = center
            .enqueue_parse_body(vault("dedupe-body"), "papers/a", JobLane::Normal, false)
            .await;
        let duplicate = center
            .enqueue_parse_body(vault("dedupe-body"), "papers/a", JobLane::Normal, false)
            .await;

        assert_eq!(first.id, duplicate.id);
        assert_eq!(first.kind, JobKind::ParseBody);
        assert_eq!(first.fingerprint, "parseBody:v1:force:false");
        assert_eq!(center.list(None, None).await.len(), 1);
    }

    #[tokio::test]
    async fn completed_job_releases_dedupe_key() {
        let center = JobCenter::new();
        let first = center
            .enqueue_parse_refs(vault("release"), "papers/a", JobLane::Normal, false)
            .await;

        center.mark_succeeded_for_test(&first.id).await;

        let next = center
            .enqueue_parse_refs(vault("release"), "papers/a", JobLane::Normal, false)
            .await;
        assert_ne!(first.id, next.id);
    }

    #[tokio::test]
    async fn focus_promotes_matching_paper_jobs() {
        let center = JobCenter::new();
        let vault = vault("focus");
        let target = center
            .enqueue_parse_refs(vault.clone(), "papers/a", JobLane::Normal, false)
            .await;
        center
            .enqueue_parse_refs(vault.clone(), "papers/b", JobLane::Normal, false)
            .await;

        let promoted = center.promote_paper(&vault, "papers/a").await;

        assert_eq!(promoted.len(), 1);
        assert_eq!(promoted[0].id, target.id);
        assert_eq!(promoted[0].lane, JobLane::Focus);
        assert_eq!(
            center.next_queued_for_test().await.as_deref(),
            Some(target.id.as_str())
        );
    }

    #[tokio::test]
    async fn list_filters_by_vault_and_path() {
        let center = JobCenter::new();
        let vault_a = vault("list-a");
        let vault_b = vault("list-b");
        center
            .enqueue_parse_refs(vault_a.clone(), "papers/a", JobLane::Normal, false)
            .await;
        center
            .enqueue_parse_refs(vault_a.clone(), "papers/b", JobLane::Normal, false)
            .await;
        center
            .enqueue_parse_refs(vault_b.clone(), "papers/a", JobLane::Normal, false)
            .await;

        assert_eq!(center.list(Some(&vault_a), None).await.len(), 2);
        let filtered = center.list(Some(&vault_a), Some("papers/a")).await;
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].paper_path.as_deref(), Some("papers/a"));
    }

    #[tokio::test]
    async fn cancel_marks_queued_job_cancelled() {
        let center = JobCenter::new();
        let job = center
            .enqueue_parse_refs(vault("cancel"), "papers/a", JobLane::Normal, false)
            .await;

        assert!(center.cancel(&job.id).await);
        let jobs = center.list(None, Some("papers/a")).await;
        assert_eq!(jobs[0].state, JobState::Cancelled);
    }

    #[test]
    fn dependency_policy_shape_round_trips() {
        let settled = serde_json::to_value(DepPolicy::AllSettled).unwrap();
        let succeeded = serde_json::to_value(DepPolicy::AllSucceeded).unwrap();
        assert_eq!(settled, serde_json::json!("allSettled"));
        assert_eq!(succeeded, serde_json::json!("allSucceeded"));
    }
}
