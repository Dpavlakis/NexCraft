import { useDefineApi } from "@/stores/useDefineApi";
import type { RemoteMappingEntry } from "@/tools/protocol";

export interface BackupConfig {
  compress: boolean;
  maxBackups: number;
  exclusions: string[];
  shutdown: boolean;
  preCommand: string;
  postCommand: string;
}

export interface BackupItem {
  name: string;
  size: number;
  time: number;
}

// Get the backup configuration for an instance
export const getBackupConfig = useDefineApi<
  {
    params: {
      daemonId: string;
      uuid: string;
    };
  },
  BackupConfig
>({
  url: "/api/protected_backup/config",
  method: "GET"
});

// Update the backup configuration for an instance
export const setBackupConfig = useDefineApi<
  {
    params: {
      daemonId: string;
      uuid: string;
    };
    data: BackupConfig;
  },
  BackupConfig
>({
  url: "/api/protected_backup/config",
  method: "PUT"
});

// List existing backups
export const backupList = useDefineApi<
  {
    params: {
      daemonId: string;
      uuid: string;
    };
  },
  BackupItem[]
>({
  url: "/api/protected_backup/list",
  method: "GET"
});

// Start a backup
export const createBackup = useDefineApi<
  {
    params: {
      daemonId: string;
      uuid: string;
    };
  },
  { taskId: string }
>({
  url: "/api/protected_backup/create",
  method: "POST"
});

// Delete a backup
export const deleteBackup = useDefineApi<
  {
    params: {
      daemonId: string;
      uuid: string;
      file_name: string;
    };
  },
  boolean
>({
  url: "/api/protected_backup",
  method: "DELETE"
});

// Restore a backup
export const restoreBackup = useDefineApi<
  {
    params: {
      daemonId: string;
      uuid: string;
    };
    data: {
      file_name: string;
    };
  },
  { taskId: string }
>({
  url: "/api/protected_backup/restore",
  method: "POST"
});

// Poll a backup/restore task status
export const backupTaskStatus = useDefineApi<
  {
    params: {
      daemonId: string;
      uuid: string;
      task_id: string;
    };
  },
  {
    taskId: string;
    status: number;
    instanceStatus: number;
    progress?: {
      percentage: number;
      processedBytes: number;
      totalBytes: number;
      entries: number;
    };
  } | null
>({
  url: "/api/protected_backup/task_status",
  method: "GET"
});

// Get a one-time download address for a backup file
export const backupDownloadAddress = useDefineApi<
  {
    params: {
      daemonId: string;
      uuid: string;
      file_name: string;
    };
  },
  {
    password: string;
    addr: string;
    remoteMappings?: RemoteMappingEntry[];
  }
>({
  url: "/api/protected_backup/download",
  method: "POST"
});
