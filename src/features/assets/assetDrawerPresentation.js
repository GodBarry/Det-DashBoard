const drawerTitles = {
  cluster: "登记模型",
  version: "登记模型版本",
  algorithm: "导入算法适配",
  env: "登记Python 环境",
};

export function getAssetDrawerTitle(mode) {
  return drawerTitles[mode] || "登记资产";
}

export function getAssetDrawerSubtitle(mode) {
  if (mode === "version") return "将权重文件登记为模型资产并存入 MinIO";
  if (mode === "algorithm") return "将算法源码、入口文件和默认参数注册为统一适配";
  if (mode === "env") return "登记 Python 运行环境，供训练和推理任务复";
  return "登记为平台统一资产，供训练和推理调";
}
