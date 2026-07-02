const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(process.argv[2] || "/tmp/det-dashboard-test/datasets");

async function image(target, width, height, background) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background } }).png().toFile(target);
}

async function main() {
  fs.mkdirSync(root, { recursive: true });

  const labelmeRoot = path.join(root, "labelme", "scene-labelme");
  await image(path.join(labelmeRoot, "images", "one.png"), 120, 80, "#d13f3f");
  fs.mkdirSync(path.join(labelmeRoot, "jsons"), { recursive: true });
  fs.writeFileSync(path.join(labelmeRoot, "jsons", "one.json"), JSON.stringify({
    version: "5.5.0",
    imagePath: "../images/one.png",
    imageWidth: 120,
    imageHeight: 80,
    scene: "labelme-meta",
    view: "ground",
    shapes: [{ label: "car", points: [[10, 10], [40, 30]], shape_type: "rectangle" }],
  }, null, 2));

  const cocoRoot = path.join(root, "coco", "scene-coco");
  await image(path.join(cocoRoot, "images", "two.png"), 100, 100, "#3fa85d");
  fs.mkdirSync(path.join(cocoRoot, "annotations"), { recursive: true });
  fs.writeFileSync(path.join(cocoRoot, "annotations", "instances.json"), JSON.stringify({
    info: { description: "integration fixture" },
    images: [{ id: 1, file_name: "two.png", width: 100, height: 100 }],
    categories: [{ id: 4, name: "ship" }],
    annotations: [{ id: 11, image_id: 1, category_id: 4, bbox: [20, 25, 50, 40], area: 2000, iscrowd: 0 }],
  }, null, 2));

  const yoloRoot = path.join(root, "yolo", "scene-yolo");
  await image(path.join(yoloRoot, "images", "train", "three.png"), 200, 100, "#426dd1");
  fs.mkdirSync(path.join(yoloRoot, "labels", "train"), { recursive: true });
  fs.writeFileSync(path.join(yoloRoot, "labels", "train", "three.txt"), "1 0.5 0.5 0.4 0.2\n");
  fs.writeFileSync(path.join(yoloRoot, "data.yaml"), "names:\n  0: person\n  1: vehicle\n");

  const videoRoot = path.join(root, "video", "scene-video");
  fs.mkdirSync(videoRoot, { recursive: true });
  fs.writeFileSync(path.join(videoRoot, "clip.mp4"), Buffer.from("det-dashboard-video-fixture"));

  console.log(root);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
