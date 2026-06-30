# 目标检测数据集工作台

React + Vite 单页原型，用于按场景预览目标检测数据集，并按标注类别统计和预览目标。

## 支持的标注格式

当前解析 LabelMe 风格 JSON：

```json
{
  "version": "3.2.3",
  "shapes": [
    {
      "label": "gaoshepao",
      "points": [[1914.0, 770.0], [2251.0, 770.0], [2251.0, 903.0], [1914.0, 903.0]],
      "shape_type": "rectangle"
    }
  ],
  "imagePath": "../images/DJI_20260606104326_0001_V_00000.jpg",
  "imageHeight": 2160,
  "imageWidth": 3840,
  "view": "Aerial View",
  "scene": "Grassland",
  "keyword": ""
}
```

`view / scene / keyword` 暂时不存在时会使用默认值，后续加入后无需改 UI。

## 数据组织

前端文件选择支持两种常见结构：

```text
dataset/
  image_001.jpg
  image_001.json
```

```text
dataset/
  images/
    image_001.jpg
  jsons/
    image_001.json
```

浏览器纯前端不能随意扫描磁盘路径，所以当前版本通过“加载数据集”选择目录。若要直接读取 `E:\datasets\xxx`，建议后续加一个 Node/Express 后端扫描目录并返回索引。

## 运行

```bash
npm install
node server.js E:\your-dataset
``` 

另开一个终端：

```bash
npm run dev
```

然后打开 Vite 输出的本地地址。

后端接口默认运行在 `http://localhost:4177`，Vite 已经把 `/api` 代理到该端口。

## 缩略图和原图加载策略

- 列表、场景卡片、类别预览默认使用 `thumbUrl`。
- 点击某张图片后，右侧详情面板才使用 `fullUrl` 加载原图。
- Node 后端会优先用 `sharp` 生成 420px 宽的 WebP 缩略图。
- 缩略图缓存目录默认在数据集根目录下：`.det-dashboard-cache/thumbs`。
- 如果 `sharp` 不可用，接口会退回直接流式返回原图，功能不受影响，但大数据集性能会下降。

## 多文件夹效率

Vite + React 本身处理多文件夹没有明显性能问题，真正影响效率的是图片数量、原图尺寸、JSON 数量和浏览器一次性解码图片的规模。建议：

- 1 千张以内：纯前端选择目录、解析 JSON、缩略图懒加载基本够用。
- 1 万张级别：使用当前这种后端扫描索引、分页、缩略图缓存。页面只渲染当前页，后续如果需要“无限滚动”，再接入 `react-window` 做真正虚拟列表。
- 4K 原图很多：不要直接全量加载原图，应生成缩略图和目标 crop 缓存。
- 类别统计：JSON 解析后建立 `scene -> images`、`label -> boxes` 索引，React 只渲染当前筛选结果。

这个项目的界面层已经按索引模型组织，后续接后端时只需要替换数据加载入口。
