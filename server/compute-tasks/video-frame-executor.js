"use strict";

const videoFrameScript = String.raw`import argparse
import json
import os

import cv2


def save_frame(frame, output_dir, frame_index):
    target = os.path.join(output_dir, f"frame_{frame_index:09d}.jpg")
    if not cv2.imwrite(target, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 95]):
        raise RuntimeError(f"failed to write frame {frame_index}")
    return target


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--interval", type=int, default=0)
    parser.add_argument("--indices", default="[]")
    args = parser.parse_args()
    os.makedirs(args.output_dir, exist_ok=True)
    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        raise RuntimeError("cannot open video")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    requested = sorted(set(int(value) for value in json.loads(args.indices or "[]") if int(value) >= 0))
    requested_set = set(requested)
    rows = []
    index = 0
    last_saved = -1
    max_requested = requested[-1] if requested else -1
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        should_save = index in requested_set if requested else (
            args.interval > 0 and (index % args.interval == 0 or (total > 0 and index == total - 1))
        )
        if should_save and index != last_saved:
            target = save_frame(frame, args.output_dir, index)
            rows.append({
                "frameIndex": index,
                "timestampMs": int(round(index * 1000.0 / fps)) if fps > 0 else 0,
                "path": target,
            })
            last_saved = index
        if requested and index >= max_requested:
            break
        if index % 25 == 0:
            denominator = max_requested + 1 if requested else max(total, 1)
            print(f"FRAME_PROGRESS {min(index + 1, denominator)}/{denominator}", flush=True)
        index += 1
    capture.release()
    metadata = {
        "fps": fps,
        "totalFrames": total if total > 0 else index,
        "width": width,
        "height": height,
        "durationMs": int(round(total * 1000.0 / fps)) if fps > 0 and total > 0 else 0,
    }
    with open(args.manifest, "w", encoding="utf-8") as handle:
        json.dump({"metadata": metadata, "frames": rows}, handle, ensure_ascii=False)
    final_total = max_requested + 1 if requested else max(total, 1)
    print(f"FRAME_PROGRESS {final_total}/{final_total}", flush=True)


if __name__ == "__main__":
    main()
`;

function createVideoFrameExecutor({
  query, transaction, fs, path, storageRoot, store, writeObjectToFile, runChildProcess,
  hashFile, imageObjectKey, sharp, processRef = process,
}) {
  function pythonPath() {
    const candidates = [
      processRef.env.VIDEO_PYTHON_PATH,
      processRef.env.CONDA_PREFIX ? path.join(processRef.env.CONDA_PREFIX, "python.exe") : "",
      "D:\\Program Files\\miniforge3\\python.exe",
    ].filter(Boolean);
    const resolved = candidates.find((candidate) => fs.existsSync(candidate));
    if (!resolved) throw new Error("视频处理 Python 不可用，请配置 VIDEO_PYTHON_PATH");
    return resolved;
  }

  async function videoRow(projectVideoId) {
    const row = (await query(
      `SELECT pv.*,va.id AS video_asset_id,va.object_key,va.original_ext,va.metadata_json
       FROM project_videos pv JOIN video_assets va ON va.id=pv.video_asset_id
       WHERE pv.id=$1 AND pv.deleted_at IS NULL`, [projectVideoId],
    )).rows[0];
    if (!row) throw new Error("视频资产不存在");
    return row;
  }

  async function materializeVideo(video, taskRoot) {
    const target = path.join(taskRoot, `source${video.original_ext || ".mp4"}`);
    if (!fs.existsSync(target)) await writeObjectToFile(video.object_key, target);
    return target;
  }

  async function runExtraction({ task, video, outputRoot, interval = 0, indices = [], onProgress }) {
    const taskRoot = path.join(storageRoot, "runtime", "compute", task.id);
    fs.mkdirSync(outputRoot, { recursive: true });
    const scriptPath = path.join(taskRoot, "video_frames.py");
    const manifestPath = path.join(outputRoot, "manifest.json");
    const sourcePath = await materializeVideo(video, taskRoot);
    fs.writeFileSync(scriptPath, videoFrameScript, "utf8");
    const args = [scriptPath, "--video", sourcePath, "--output-dir", outputRoot, "--manifest", manifestPath];
    if (indices.length) args.push("--indices", JSON.stringify(indices));
    else args.push("--interval", String(interval));
    await runChildProcess(pythonPath(), args, {
      cwd: taskRoot,
      env: { ...processRef.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
      onSpawn: (child) => query("UPDATE compute_tasks SET process_pid=$1 WHERE id=$2", [child.pid || null, task.id]).catch(() => {}),
      onStdout: (text) => onProgress?.(text),
      onStderr: (text) => onProgress?.(text, "stderr"),
    });
    if (!fs.existsSync(manifestPath)) throw new Error("视频抽帧没有生成清单");
    return { ...JSON.parse(fs.readFileSync(manifestPath, "utf8")), sourcePath };
  }

  async function registerFrame(task, video, frame, interval) {
    const sha = await hashFile(frame.path);
    const stat = fs.statSync(frame.path);
    const metadata = await sharp(frame.path).metadata();
    const objectKey = imageObjectKey(sha, ".jpg");
    let asset = (await query("SELECT * FROM image_assets WHERE sha256=$1", [sha])).rows[0];
    if (!asset) {
      await store.putFile(objectKey, frame.path);
      asset = (await query(
        `INSERT INTO image_assets (sha256,quick_hash,object_key,original_ext,width,height,file_size)
         VALUES ($1,$1,$2,'.jpg',$3,$4,$5) RETURNING *`,
        [sha, objectKey, Number(metadata.width) || null, Number(metadata.height) || null, stat.size],
      )).rows[0];
    } else if (await store.objectSize(asset.object_key) !== Number(asset.file_size || stat.size)) {
      await store.putFile(asset.object_key, frame.path);
    }
    return transaction(async (client) => {
      const existing = (await client.query(
        `SELECT pi.* FROM project_video_frames pvf JOIN project_images pi ON pi.id=pvf.project_image_id
         WHERE pvf.project_video_id=$1 AND pvf.source_frame_index=$2`,
        [video.id, frame.frameIndex],
      )).rows[0];
      if (existing) return existing;
      const base = path.basename(video.display_name, path.extname(video.display_name));
      const displayName = `${base}_frame_${String(frame.frameIndex).padStart(9, "0")}.jpg`;
      let image = (await client.query(
        "SELECT * FROM project_images WHERE project_id=$1 AND image_asset_id=$2 AND deleted_at IS NULL LIMIT 1",
        [video.project_id, asset.id],
      )).rows[0];
      if (!image) image = (await client.query(
        `INSERT INTO project_images
         (project_id,image_asset_id,display_name,source_path,scene,view,modality,keyword)
         VALUES ($1,$2,$3,$4,'unknown','unknown','unknown','video_frame') RETURNING *`,
        [video.project_id, asset.id, displayName, `${video.source_path || video.display_name}#frame=${frame.frameIndex}`],
      )).rows[0];
      await client.query(
        `INSERT INTO project_video_frames
         (project_video_id,project_image_id,source_frame_index,timestamp_ms,extraction_interval,extraction_task_id)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (project_video_id,source_frame_index) DO NOTHING`,
        [video.id, image.id, frame.frameIndex, frame.timestampMs || 0, interval, task.id],
      );
      return image;
    });
  }

  async function executeFixedInterval(task, appendLog) {
    const input = typeof task.input_json === "string" ? JSON.parse(task.input_json || "{}") : (task.input_json || {});
    const interval = Math.max(1, Math.floor(Number(input.interval || 1)));
    const video = await videoRow(input.projectVideoId);
    const outputRoot = path.join(storageRoot, "runtime", "compute", task.id, "extracted-frames");
    let lastProgress = 5;
    const handleProgress = (text, stream = "stdout") => {
      appendLog(task.id, stream, text);
      const matches = [...String(text || "").matchAll(/FRAME_PROGRESS\s+(\d+)\/(\d+)/g)];
      if (!matches.length) return;
      const current = Number(matches.at(-1)[1]);
      const total = Math.max(1, Number(matches.at(-1)[2]));
      const progress = Math.min(75, 5 + Math.round((current / total) * 70));
      if (progress <= lastProgress) return;
      lastProgress = progress;
      query("UPDATE compute_tasks SET progress=$1,message=$2,updated_at=now() WHERE id=$3 AND status='running'", [progress, `正在按每 ${interval} 帧抽取`, task.id]).catch(() => {});
    };
    let manifest;
    try {
      manifest = await runExtraction({ task, video, outputRoot, interval, onProgress: handleProgress });
      const registered = [];
      for (let index = 0; index < manifest.frames.length; index += 1) {
        registered.push(await registerFrame(task, video, manifest.frames[index], interval));
        const progress = 75 + Math.round(((index + 1) / Math.max(1, manifest.frames.length)) * 20);
        await query("UPDATE compute_tasks SET progress=$1,message=$2,updated_at=now() WHERE id=$3", [progress, `正在登记抽帧 ${index + 1}/${manifest.frames.length}`, task.id]);
      }
      await query("UPDATE video_assets SET metadata_json=COALESCE(metadata_json,'{}'::jsonb) || $1::jsonb WHERE id=$2", [JSON.stringify(manifest.metadata || {}), video.video_asset_id]);
      return { projectVideoId: video.id, interval, extracted: registered.length, metadata: manifest.metadata || {}, projectImageIds: registered.map((row) => row.id) };
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
      fs.rmSync(manifest?.sourcePath || path.join(storageRoot, "runtime", "compute", task.id, `source${video.original_ext || ".mp4"}`), { force: true });
    }
  }

  async function supplementSequence(task, input, images, runtimePythonPath, appendLog) {
    const count = Math.max(0, Math.floor(Number(input.supplementCount || 0)));
    if (!count || images.length < 2) return { images, cleanup: null };
    const ids = images.slice(0, 2).map((row) => row.projectImageId);
    const rows = (await query(
      `SELECT pvf.*,pv.project_id,pv.display_name,pv.source_path,va.id AS video_asset_id,va.object_key,va.original_ext
       FROM project_video_frames pvf
       JOIN project_videos pv ON pv.id=pvf.project_video_id
       JOIN video_assets va ON va.id=pv.video_asset_id
       WHERE pvf.project_image_id=ANY($1::uuid[])`, [ids],
    )).rows;
    const byImage = new Map(rows.map((row) => [String(row.project_image_id), row]));
    const left = byImage.get(String(ids[0]));
    const right = byImage.get(String(ids[1]));
    if (!left || !right || String(left.project_video_id) !== String(right.project_video_id)) {
      throw new Error("当前帧与下一帧不是同一视频的连续抽帧，无法补帧");
    }
    const gap = Number(right.source_frame_index) - Number(left.source_frame_index);
    if (gap <= 1) throw new Error("当前区间没有可补充的原始帧");
    const actualCount = Math.min(count, gap - 1);
    const indices = [...new Set(Array.from({ length: actualCount }, (_, offset) =>
      Number(left.source_frame_index) + Math.round((gap * (offset + 1)) / (actualCount + 1)),
    ))].filter((value) => value > Number(left.source_frame_index) && value < Number(right.source_frame_index));
    const video = { ...left, id: left.project_video_id };
    const outputRoot = path.join(storageRoot, "runtime", "compute", task.id, "supplemental-frames");
    const originalVideoPython = processRef.env.VIDEO_PYTHON_PATH;
    processRef.env.VIDEO_PYTHON_PATH = runtimePythonPath;
    let manifest;
    try {
      manifest = await runExtraction({ task, video, outputRoot, indices, onProgress: (text, stream = "stdout") => appendLog(task.id, stream, text) });
    } finally {
      if (originalVideoPython == null) delete processRef.env.VIDEO_PYTHON_PATH;
      else processRef.env.VIDEO_PYTHON_PATH = originalVideoPython;
    }
    const temporary = manifest.frames.map((frame) => ({
      projectImageId: null,
      path: frame.path,
      frameIndex: null,
      sequenceIndex: null,
      displayName: path.basename(frame.path),
      persistSuggestion: false,
      sourceFrameIndex: frame.frameIndex,
    }));
    await query("UPDATE compute_tasks SET progress=18,message=$1,updated_at=now() WHERE id=$2", [`已准备 ${temporary.length} 张临时补帧`, task.id]);
    return { images: [images[0], ...temporary, ...images.slice(1)], cleanup: [outputRoot, manifest.sourcePath], supplementalFrameIndices: indices };
  }

  return { executeFixedInterval, supplementSequence };
}

module.exports = { createVideoFrameExecutor };
