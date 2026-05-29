// @Entity
// Per-instance backup configuration, persisted via StorageSubsystem under the "BackupConfig" category.
export default class BackupConfig {
  // true => deflate (zlib level 9), false => store (no compression, faster)
  compress = true;
  // Maximum number of backups to keep. 0 = keep all (no automatic deletion)
  maxBackups = 0;
  // Glob patterns (relative to the instance working directory) excluded from the archive
  exclusions: string[] = [];
  // Stop the instance before backing up and restart it afterwards (for a consistent snapshot)
  shutdown = false;
  // Console command executed before the backup (only when the instance is running)
  preCommand = "";
  // Console command executed after the backup (only when the instance is running)
  postCommand = "";
}
