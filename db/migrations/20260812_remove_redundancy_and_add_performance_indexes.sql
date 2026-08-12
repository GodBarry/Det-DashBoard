-- Thor production migration: remove the retired redundancy feature and add
-- indexes used by large dataset browsing, evaluation, and runtime queues.
-- Take a verified database backup before applying this migration.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';

ALTER TABLE IF EXISTS projects DROP COLUMN IF EXISTS redundancy_rate;
ALTER TABLE IF EXISTS project_images DROP COLUMN IF EXISTS redundancy_rate;
ALTER TABLE IF EXISTS project_videos DROP COLUMN IF EXISTS redundancy_rate;

CREATE INDEX IF NOT EXISTS idx_projects_parent_active
  ON projects(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_images_project_created_active
  ON project_images(project_id, created_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_import_batches_project_created_active
  ON import_batches(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_label_versions_project_created_active
  ON label_versions(project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_image_ann_version_image
  ON image_annotations(label_version_id, project_image_id);
CREATE INDEX IF NOT EXISTS idx_image_ann_version_label
  ON image_annotations(label_version_id, label);

CREATE INDEX IF NOT EXISTS idx_runtime_inference_jobs_queue
  ON runtime_inference_jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_runtime_inference_results_job_created
  ON runtime_inference_results(inference_job_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_runtime_inference_results_job_image
  ON runtime_inference_results(inference_job_id, project_image_id);
CREATE INDEX IF NOT EXISTS idx_runtime_inference_logs_job_id_desc
  ON runtime_inference_logs(job_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_training_jobs_queue
  ON runtime_training_jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_runtime_training_logs_job_id_desc
  ON runtime_training_logs(job_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_training_metrics_job_id_desc
  ON runtime_training_metrics(job_id, id DESC);

COMMIT;

ANALYZE projects;
ANALYZE project_images;
ANALYZE image_annotations;
ANALYZE runtime_inference_jobs;
ANALYZE runtime_inference_results;
