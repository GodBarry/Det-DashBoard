-- PostgreSQL 13+ provides gen_random_uuid() in pg_catalog. Do not require
-- pgcrypto here because some lightweight local PostgreSQL packages omit contrib.

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  active_label_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  import_mode TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_files INT NOT NULL DEFAULT 0,
  processed_files INT NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS image_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 TEXT UNIQUE,
  quick_hash TEXT,
  object_key TEXT NOT NULL,
  original_ext TEXT,
  width INT,
  height INT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_image_assets_quick_hash ON image_assets(quick_hash);

CREATE TABLE IF NOT EXISTS video_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 TEXT UNIQUE,
  quick_hash TEXT,
  object_key TEXT NOT NULL,
  original_ext TEXT,
  width INT,
  height INT,
  duration_ms BIGINT,
  fps NUMERIC,
  frame_count BIGINT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_video_assets_quick_hash ON video_assets(quick_hash);

CREATE TABLE IF NOT EXISTS project_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  image_asset_id UUID NOT NULL REFERENCES image_assets(id),
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  scene TEXT NOT NULL DEFAULT '',
  view TEXT NOT NULL DEFAULT '',
  modality TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_images_project ON project_images(project_id);
CREATE INDEX IF NOT EXISTS idx_project_images_scene ON project_images(scene);
CREATE INDEX IF NOT EXISTS idx_project_images_modality ON project_images(modality);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_images_unique_asset ON project_images(project_id, image_asset_id, display_name);

CREATE TABLE IF NOT EXISTS project_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_asset_id UUID NOT NULL REFERENCES video_assets(id),
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  scene TEXT NOT NULL DEFAULT '',
  view TEXT NOT NULL DEFAULT '',
  modality TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL DEFAULT '',
  label_status TEXT NOT NULL DEFAULT 'unlabeled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_videos_project ON project_videos(project_id);
CREATE INDEX IF NOT EXISTS idx_project_videos_status ON project_videos(label_status);

CREATE TABLE IF NOT EXISTS label_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_label_versions_project ON label_versions(project_id);

ALTER TABLE projects
  ADD CONSTRAINT fk_projects_active_label_version
  FOREIGN KEY (active_label_version_id) REFERENCES label_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS image_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label_version_id UUID NOT NULL REFERENCES label_versions(id) ON DELETE CASCADE,
  project_image_id UUID NOT NULL REFERENCES project_images(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  bbox_x NUMERIC,
  bbox_y NUMERIC,
  bbox_w NUMERIC,
  bbox_h NUMERIC,
  shape_type TEXT NOT NULL DEFAULT 'rectangle',
  difficult BOOLEAN NOT NULL DEFAULT false,
  score NUMERIC,
  attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_image_ann_version ON image_annotations(label_version_id);
CREATE INDEX IF NOT EXISTS idx_image_ann_project_image ON image_annotations(project_image_id);
CREATE INDEX IF NOT EXISTS idx_image_ann_label ON image_annotations(label);

CREATE TABLE IF NOT EXISTS video_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label_version_id UUID NOT NULL REFERENCES label_versions(id) ON DELETE CASCADE,
  project_video_id UUID NOT NULL REFERENCES project_videos(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_time_ms BIGINT,
  end_time_ms BIGINT,
  frame_index BIGINT,
  bbox_x NUMERIC,
  bbox_y NUMERIC,
  bbox_w NUMERIC,
  bbox_h NUMERIC,
  shape_type TEXT NOT NULL DEFAULT 'rectangle',
  difficult BOOLEAN NOT NULL DEFAULT false,
  score NUMERIC,
  attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_video_ann_version ON video_annotations(label_version_id);
CREATE INDEX IF NOT EXISTS idx_video_ann_project_video ON video_annotations(project_video_id);
CREATE INDEX IF NOT EXISTS idx_video_ann_label ON video_annotations(label);

CREATE TABLE IF NOT EXISTS extracted_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_video_id UUID NOT NULL REFERENCES project_videos(id) ON DELETE CASCADE,
  image_asset_id UUID NOT NULL REFERENCES image_assets(id),
  frame_index BIGINT,
  time_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status);

CREATE TABLE IF NOT EXISTS export_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
  export_image_name TEXT NOT NULL,
  export_json_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
