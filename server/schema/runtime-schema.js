async function ensureRuntimeSchema({ query, authService, seedMlRuntimeConfig }) {
  const statements = [
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT NOT NULL DEFAULT 'normal'",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES projects(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id)",
    "ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE project_images ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE project_images ADD COLUMN IF NOT EXISTS source_path TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    "ALTER TABLE project_videos ADD COLUMN IF NOT EXISTS source_path TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE label_versions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ",
    `CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      display_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS baseline_merge_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      baseline_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      source_project_ids UUID[] NOT NULL,
      params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'preview',
      summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      log_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS baseline_conflicts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merge_run_id UUID NOT NULL REFERENCES baseline_merge_runs(id) ON DELETE CASCADE,
      image_asset_id UUID NOT NULL REFERENCES image_assets(id),
      conflict_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      resolution TEXT NOT NULL DEFAULT '',
      preview_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS baseline_annotation_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merge_run_id UUID NOT NULL REFERENCES baseline_merge_runs(id) ON DELETE CASCADE,
      baseline_annotation_id UUID REFERENCES image_annotations(id) ON DELETE SET NULL,
      source_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_project_image_id UUID NOT NULL REFERENCES project_images(id) ON DELETE CASCADE,
      source_annotation_id UUID REFERENCES image_annotations(id) ON DELETE SET NULL,
      resolution_method TEXT NOT NULL DEFAULT '',
      annotation_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS model_clusters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'detect',
      framework TEXT NOT NULL DEFAULT 'ultralytics',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS dataset_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      label_version_id UUID REFERENCES label_versions(id) ON DELETE SET NULL,
      format TEXT NOT NULL DEFAULT 'yolo',
      split_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      path TEXT NOT NULL DEFAULT '',
      image_count INT NOT NULL DEFAULT 0,
      annotation_count INT NOT NULL DEFAULT 0,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_training_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
      dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      dataset_snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
      model_id UUID REFERENCES model_clusters(id) ON DELETE SET NULL,
      generated_model_version_id UUID,
      initial_model_version_id UUID,
      initialization_strategy TEXT NOT NULL DEFAULT 'random',
      resume_from_checkpoint BOOLEAN NOT NULL DEFAULT false,
      save_period INT NOT NULL DEFAULT -1,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INT NOT NULL DEFAULT 0,
      params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      progress INT NOT NULL DEFAULT 0,
      current_epoch INT NOT NULL DEFAULT 0,
      total_epochs INT NOT NULL DEFAULT 0,
      worker_id TEXT NOT NULL DEFAULT '',
      process_pid INT,
      heartbeat_at TIMESTAMPTZ,
      output_root TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_training_logs (
      id BIGSERIAL PRIMARY KEY,
      job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
      stream TEXT NOT NULL DEFAULT 'stdout',
      line TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_training_metrics (
      id BIGSERIAL PRIMARY KEY,
      job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
      step INT NOT NULL DEFAULT 0,
      epoch INT NOT NULL DEFAULT 0,
      key TEXT NOT NULL,
      value NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS model_revisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_id UUID NOT NULL REFERENCES model_clusters(id) ON DELETE CASCADE,
      version_name TEXT NOT NULL,
      training_job_id UUID REFERENCES runtime_training_jobs(id) ON DELETE SET NULL,
      dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      dataset_snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
      stage TEXT NOT NULL DEFAULT 'candidate',
      metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      artifact_root TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS model_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_version_id UUID REFERENCES model_revisions(id) ON DELETE CASCADE,
      training_job_id UUID REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL,
      path TEXT NOT NULL,
      size BIGINT,
      sha256 TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_inference_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      model_version_id UUID REFERENCES model_revisions(id) ON DELETE SET NULL,
      dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INT NOT NULL DEFAULT 0,
      params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      progress INT NOT NULL DEFAULT 0,
      output_root TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_inference_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inference_job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
      project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
      predictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      artifact_path TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_inference_logs (
      id BIGSERIAL PRIMARY KEY,
      job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
      stream TEXT NOT NULL DEFAULT 'stdout',
      line TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS runtime_asset_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      algorithm_asset_id UUID,
      model_id UUID,
      model_version_id UUID,
      python_env_id UUID,
      dataset_project_id UUID,
      last_success_job_id UUID,
      success_count INT NOT NULL DEFAULT 0,
      last_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_success_at TIMESTAMPTZ
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_asset_links_unique
      ON runtime_asset_links (
        COALESCE(algorithm_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(model_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(python_env_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(dataset_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )`,
    `CREATE TABLE IF NOT EXISTS training_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      template_key TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
      framework TEXT NOT NULL DEFAULT 'ultralytics',
      task_type TEXT NOT NULL DEFAULT 'detect',
      command_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      default_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0",
    "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE training_templates ADD COLUMN IF NOT EXISTS capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb",
    `CREATE TABLE IF NOT EXISTS runtime_envs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      python_path TEXT NOT NULL,
      env_type TEXT NOT NULL DEFAULT 'miniforge',
      os_type TEXT NOT NULL DEFAULT 'windows',
      arch TEXT NOT NULL DEFAULT 'x86_64',
      accelerator TEXT NOT NULL DEFAULT 'cpu',
      status TEXT NOT NULL DEFAULT 'unknown',
      python_version TEXT NOT NULL DEFAULT '',
      torch_version TEXT NOT NULL DEFAULT '',
      cuda_available BOOLEAN NOT NULL DEFAULT false,
      cuda_version TEXT NOT NULL DEFAULT '',
      packages_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS os_type TEXT NOT NULL DEFAULT 'windows'",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS arch TEXT NOT NULL DEFAULT 'x86_64'",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS accelerator TEXT NOT NULL DEFAULT 'cpu'",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS python_version TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS torch_version TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS cuda_available BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS cuda_version TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'server_python'",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS artifact_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS artifact_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS artifact_size BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS artifact_sha256 TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE runtime_envs ADD COLUMN IF NOT EXISTS unpack_path TEXT NOT NULL DEFAULT ''",
  ];
  // Core project browsing, imports, and baseline generation must always have
  // their schema available. Only the larger ML platform schema is optional.
  const runtimeStatements = process.env.RUN_EXTENDED_SCHEMA === "true" ? statements : statements.slice(0, 15);
  await query("SET statement_timeout = '5000ms'");
  await query("SET lock_timeout = '2000ms'");
  for (let index = 0; index < runtimeStatements.length; index += 1) {
    const sql = runtimeStatements[index];
    try {
      console.log(`Schema ${index + 1}/${runtimeStatements.length}: ${sql.slice(0, 90).replace(/\s+/g, " ")}`);
      await query(sql);
    } catch (error) {
      // Existing runtime folders can contain partially-applied Postgres defaults.
      // Treat duplicate catalog/default entries as already migrated.
      if (error.code === "23505" && String(error.constraint || "").includes("pg_attrdef")) {
        console.warn("Skipping already-applied schema default:", sql.slice(0, 120));
        continue;
      }
      if (error.code === "57014") {
        console.warn("Skipping timed-out schema statement:", sql.slice(0, 120));
        continue;
      }
      if (error.code === "XX002") {
        console.warn("Skipping corrupted-catalog schema statement:", sql.slice(0, 120));
        continue;
      }
      throw error;
    }
  }
  await authService.seedDefaultAdmin();
  if (process.env.RUN_EXTENDED_SCHEMA !== "true") {
    const mlRuntimeStatements = [
      `CREATE TABLE IF NOT EXISTS model_clusters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'detect',
        framework TEXT NOT NULL DEFAULT 'ultralytics',
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS dataset_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        source_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        label_version_id UUID REFERENCES label_versions(id) ON DELETE SET NULL,
        format TEXT NOT NULL DEFAULT 'yolo',
        split_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        path TEXT NOT NULL DEFAULT '',
        image_count INT NOT NULL DEFAULT 0,
        annotation_count INT NOT NULL DEFAULT 0,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS training_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        template_key TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
        framework TEXT NOT NULL DEFAULT 'ultralytics',
        task_type TEXT NOT NULL DEFAULT 'detect',
        command_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        default_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_envs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        python_path TEXT NOT NULL,
        env_type TEXT NOT NULL DEFAULT 'miniforge',
        os_type TEXT NOT NULL DEFAULT 'windows',
        arch TEXT NOT NULL DEFAULT 'x86_64',
        accelerator TEXT NOT NULL DEFAULT 'cpu',
        status TEXT NOT NULL DEFAULT 'unknown',
        python_version TEXT NOT NULL DEFAULT '',
        torch_version TEXT NOT NULL DEFAULT '',
        cuda_available BOOLEAN NOT NULL DEFAULT false,
        cuda_version TEXT NOT NULL DEFAULT '',
        packages_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_type TEXT NOT NULL DEFAULT 'server_python',
        artifact_key TEXT NOT NULL DEFAULT '',
        artifact_name TEXT NOT NULL DEFAULT '',
        artifact_size BIGINT NOT NULL DEFAULT 0,
        artifact_sha256 TEXT NOT NULL DEFAULT '',
        unpack_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS model_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_id UUID NOT NULL REFERENCES model_clusters(id) ON DELETE CASCADE,
        version_name TEXT NOT NULL,
        training_job_id UUID,
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        dataset_snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
        stage TEXT NOT NULL DEFAULT 'candidate',
        metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        artifact_root TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS model_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_version_id UUID REFERENCES model_revisions(id) ON DELETE CASCADE,
        training_job_id UUID,
        artifact_type TEXT NOT NULL,
        path TEXT NOT NULL,
        size BIGINT,
        sha256 TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        dataset_snapshot_id UUID REFERENCES dataset_snapshots(id) ON DELETE SET NULL,
        model_id UUID REFERENCES model_clusters(id) ON DELETE SET NULL,
        generated_model_version_id UUID,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INT NOT NULL DEFAULT 0,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        current_epoch INT NOT NULL DEFAULT 0,
        total_epochs INT NOT NULL DEFAULT 0,
        worker_id TEXT NOT NULL DEFAULT '',
        process_pid INT,
        heartbeat_at TIMESTAMPTZ,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_logs (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
        stream TEXT NOT NULL DEFAULT 'stdout',
        line TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_metrics (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
        step INT NOT NULL DEFAULT 0,
        epoch INT NOT NULL DEFAULT 0,
        key TEXT NOT NULL,
        value NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_inference_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        model_version_id UUID REFERENCES model_revisions(id) ON DELETE SET NULL,
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INT NOT NULL DEFAULT 0,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0",
      "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb",
      `CREATE TABLE IF NOT EXISTS runtime_inference_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inference_job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
        project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
        predictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        artifact_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_inference_logs (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
        stream TEXT NOT NULL DEFAULT 'stdout',
        line TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_asset_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        algorithm_asset_id UUID,
        model_id UUID,
        model_version_id UUID,
        python_env_id UUID,
        dataset_project_id UUID,
        last_success_job_id UUID,
        success_count INT NOT NULL DEFAULT 0,
        last_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_success_at TIMESTAMPTZ
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_asset_links_unique
        ON runtime_asset_links (
          COALESCE(algorithm_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(model_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(python_env_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(dataset_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )`,
    ];
    const assetRuntimeStatements = [
      mlRuntimeStatements[0],
      mlRuntimeStatements[1],
      mlRuntimeStatements[2],
      `CREATE TABLE IF NOT EXISTS runtime_envs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        python_path TEXT NOT NULL,
        env_type TEXT NOT NULL DEFAULT 'server_python',
        os_type TEXT NOT NULL DEFAULT 'windows',
        arch TEXT NOT NULL DEFAULT 'x86_64',
        accelerator TEXT NOT NULL DEFAULT 'cpu',
        status TEXT NOT NULL DEFAULT 'unknown',
        python_version TEXT NOT NULL DEFAULT '',
        torch_version TEXT NOT NULL DEFAULT '',
        cuda_available BOOLEAN NOT NULL DEFAULT false,
        cuda_version TEXT NOT NULL DEFAULT '',
        packages_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_type TEXT NOT NULL DEFAULT 'server_python',
        artifact_key TEXT NOT NULL DEFAULT '',
        artifact_name TEXT NOT NULL DEFAULT '',
        artifact_size BIGINT NOT NULL DEFAULT 0,
        artifact_sha256 TEXT NOT NULL DEFAULT '',
        unpack_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS model_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_id UUID NOT NULL REFERENCES model_clusters(id) ON DELETE CASCADE,
        version_name TEXT NOT NULL,
        training_job_id UUID,
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        dataset_snapshot_id UUID,
        stage TEXT NOT NULL DEFAULT 'candidate',
        metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        artifact_root TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS model_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_version_id UUID REFERENCES model_revisions(id) ON DELETE CASCADE,
        training_job_id UUID,
        artifact_type TEXT NOT NULL,
        path TEXT NOT NULL,
        size BIGINT,
        sha256 TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS algorithm_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        algorithm_key TEXT NOT NULL,
        framework TEXT NOT NULL DEFAULT '',
        task_type TEXT NOT NULL DEFAULT 'detect',
        version TEXT NOT NULL DEFAULT 'builtin',
        source_type TEXT NOT NULL DEFAULT 'builtin',
        minio_prefix TEXT NOT NULL,
        manifest_key TEXT NOT NULL,
        adapter_key TEXT NOT NULL DEFAULT '',
        source_prefix TEXT NOT NULL DEFAULT '',
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        default_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ready',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ,
        UNIQUE (algorithm_key, version)
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        template TEXT NOT NULL DEFAULT 'ultralytics_yolo_detect',
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        dataset_snapshot_id UUID,
        model_id UUID REFERENCES model_clusters(id) ON DELETE SET NULL,
        generated_model_version_id UUID,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INT NOT NULL DEFAULT 0,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        current_epoch INT NOT NULL DEFAULT 0,
        total_epochs INT NOT NULL DEFAULT 0,
        worker_id TEXT NOT NULL DEFAULT '',
        process_pid INT,
        heartbeat_at TIMESTAMPTZ,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_logs (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
        stream TEXT NOT NULL DEFAULT 'stdout',
        line TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_training_metrics (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_training_jobs(id) ON DELETE CASCADE,
        step INT NOT NULL DEFAULT 0,
        epoch INT NOT NULL DEFAULT 0,
        key TEXT NOT NULL,
        value NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_inference_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        model_version_id UUID REFERENCES model_revisions(id) ON DELETE SET NULL,
        dataset_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority INT NOT NULL DEFAULT 0,
        params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress INT NOT NULL DEFAULT 0,
        output_root TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
      "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0",
      "ALTER TABLE runtime_inference_jobs ADD COLUMN IF NOT EXISTS metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb",
      `CREATE TABLE IF NOT EXISTS runtime_inference_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        inference_job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
        project_image_id UUID REFERENCES project_images(id) ON DELETE SET NULL,
        predictions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        artifact_path TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_inference_logs (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES runtime_inference_jobs(id) ON DELETE CASCADE,
        stream TEXT NOT NULL DEFAULT 'stdout',
        line TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS runtime_asset_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        algorithm_asset_id UUID,
        model_id UUID,
        model_version_id UUID,
        python_env_id UUID,
        dataset_project_id UUID,
        last_success_job_id UUID,
        success_count INT NOT NULL DEFAULT 0,
        last_metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_success_at TIMESTAMPTZ
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_asset_links_unique
        ON runtime_asset_links (
          COALESCE(algorithm_asset_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(model_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(python_env_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(dataset_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )`,
    ];
    const enabledMlRuntimeStatements = process.env.RUN_ML_SCHEMA === "true" ? mlRuntimeStatements : assetRuntimeStatements;
    for (let index = 0; index < enabledMlRuntimeStatements.length; index += 1) {
      const sql = enabledMlRuntimeStatements[index];
      try {
        const tableMatch = sql.match(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/i);
        if (tableMatch) {
          const exists = await query("SELECT to_regclass($1) AS name", [tableMatch[1]]);
          if (exists.rows[0]?.name) {
            console.log(`ML schema ${index + 1}/${enabledMlRuntimeStatements.length}: skip existing ${tableMatch[1]}`);
            continue;
          }
        }
        console.log(`ML schema ${index + 1}/${enabledMlRuntimeStatements.length}: ${sql.slice(0, 90).replace(/\s+/g, " ")}`);
        await query(sql);
      } catch (error) {
        if (error.code === "57014") {
          console.warn("Skipping timed-out ML schema statement:", sql.slice(0, 120));
          continue;
        }
        if (error.code === "55P03") {
          console.warn("Skipping locked ML schema statement:", sql.slice(0, 120));
          continue;
        }
        if (error.code === "XX002") {
          console.warn("Skipping corrupted-catalog ML schema statement:", sql.slice(0, 120));
          continue;
        }
        throw error;
      }
    }
    if (process.env.RUN_ML_SCHEMA === "true") await seedMlRuntimeConfig();
  }
  if (process.env.RUN_EXTENDED_SCHEMA === "true") await seedMlRuntimeConfig();

  const modelArtifactMigrationStatements = [
    `ALTER TABLE IF EXISTS runtime_training_jobs
       ADD COLUMN IF NOT EXISTS generated_model_version_id UUID`,
    `ALTER TABLE IF EXISTS runtime_training_jobs ADD COLUMN IF NOT EXISTS initial_model_version_id UUID`,
    `ALTER TABLE IF EXISTS runtime_training_jobs ADD COLUMN IF NOT EXISTS initialization_strategy TEXT NOT NULL DEFAULT 'random'`,
    `ALTER TABLE IF EXISTS runtime_training_jobs ADD COLUMN IF NOT EXISTS resume_from_checkpoint BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE IF EXISTS runtime_training_jobs ADD COLUMN IF NOT EXISTS save_period INT NOT NULL DEFAULT -1`,
    `DO $$
     BEGIN
       IF to_regclass('runtime_training_jobs') IS NOT NULL
          AND to_regclass('model_revisions') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname='runtime_training_jobs_generated_model_version_fk'
          ) THEN
         ALTER TABLE runtime_training_jobs
           ADD CONSTRAINT runtime_training_jobs_generated_model_version_fk
           FOREIGN KEY (generated_model_version_id) REFERENCES model_revisions(id) ON DELETE SET NULL;
       END IF;
     END $$`,
    `DO $$
     BEGIN
       IF to_regclass('runtime_training_jobs') IS NOT NULL
          AND to_regclass('model_revisions') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='runtime_training_jobs_initial_model_version_fk') THEN
         ALTER TABLE runtime_training_jobs ADD CONSTRAINT runtime_training_jobs_initial_model_version_fk
           FOREIGN KEY (initial_model_version_id) REFERENCES model_revisions(id) ON DELETE SET NULL;
       END IF;
     END $$`,
    `DELETE FROM model_files newer
       USING model_files older
       WHERE newer.model_version_id=older.model_version_id
         AND newer.path=older.path
         AND (newer.created_at, newer.id) < (older.created_at, older.id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_model_files_version_path_unique
       ON model_files (model_version_id, path)`,
  ];
  for (const sql of modelArtifactMigrationStatements) await query(sql);

}

module.exports = { ensureRuntimeSchema };
