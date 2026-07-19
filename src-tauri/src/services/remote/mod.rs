//! Remote vault over SSH/SFTP and remote BYOA helpers.
//! See `docs/development/remote-vault.md`.

pub mod agent_exec;
pub mod catalog_mirror;
pub mod session;
pub mod sftp_fs;

pub use session::{
    parse_remote_handle, RemoteRegistry, RemoteSession, RemoteSessionInfo, LOCAL_SIM_HOST,
};
