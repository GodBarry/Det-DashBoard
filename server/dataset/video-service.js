"use strict";

function createVideoService({ query, resourceAccess, computeTaskService, httpError }) {
  async function projectVideo(projectVideoId) {
    const row = (await query(
      `SELECT pv.*, va.object_key, va.original_ext, va.file_size, va.metadata_json
       FROM project_videos pv
       JOIN video_assets va ON va.id=pv.video_asset_id
       WHERE pv.id=$1 AND pv.deleted_at IS NULL`,
      [projectVideoId],
    )).rows[0];
    if (!row) throw httpError(404, "视频资产不存在");
    return row;
  }

  async function listProjectVideos(projectId, actor) {
    await resourceAccess.assertProjectRead(actor, projectId);
    return (await query(
      `SELECT pv.id,pv.project_id,pv.display_name,pv.source_path,pv.label_status,pv.created_at,
              va.file_size,va.original_ext,va.metadata_json,
              count(pvf.id)::int AS extracted_frame_count,
              min(pvf.source_frame_index)::int AS first_frame_index,
              max(pvf.source_frame_index)::int AS last_frame_index
       FROM project_videos pv
       JOIN video_assets va ON va.id=pv.video_asset_id
       LEFT JOIN project_video_frames pvf ON pvf.project_video_id=pv.id
       WHERE pv.project_id=$1 AND pv.deleted_at IS NULL
       GROUP BY pv.id,va.id ORDER BY pv.created_at DESC`,
      [projectId],
    )).rows;
  }

  async function createExtractionTask(projectVideoId, body, actor) {
    const video = await projectVideo(projectVideoId);
    await resourceAccess.assertProjectWrite(actor, video.project_id);
    const interval = Math.floor(Number(body.interval));
    if (!Number.isInteger(interval) || interval < 1 || interval > 100000) {
      throw httpError(400, "抽帧间隔必须是 1 到 100000 之间的整数");
    }
    return computeTaskService.createTask({
      purpose: "video",
      operation: "fixed_interval_extract",
      executionMode: "oneshot",
      sessionKey: video.id,
      input: { projectId: video.project_id, projectVideoId: video.id, interval },
      parameters: {},
    }, actor);
  }

  return { projectVideo, listProjectVideos, createExtractionTask };
}

module.exports = { createVideoService };
