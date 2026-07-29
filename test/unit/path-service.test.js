const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createPathService } = require("../../server/platform/path-service");

function config(overrides = {}) {
  return {
    dataRoot: "C:\\data",
    dataRootDisplay: "C:\\data",
    browseRoot: "C:\\",
    browseRootDisplay: "C:\\",
    browseAllDrives: true,
    hostPathMode: "windows",
    platform: "win32",
    ...overrides,
  };
}

test("system roots expose Windows drive letters", () => {
  const service = createPathService({
    config: config(),
    fs: { existsSync: (value) => value === "C:\\" || value === "E:\\" },
    path,
  });
  const result = service.listFiles("__roots__", "browse", ".pt,.pth");
  assert.equal(result.platform, "windows");
  assert.deepEqual(result.dirs, [
    { name: "C:\\", path: "C:\\" },
    { name: "E:\\", path: "E:\\" },
  ]);
  assert.deepEqual(result.files, []);
});

test("system roots expose the Ubuntu filesystem root", () => {
  const service = createPathService({
    config: config({
      platform: "linux",
      hostPathMode: "posix",
      dataRoot: "/srv/data",
      dataRootDisplay: "/srv/data",
      browseRoot: "/",
      browseRootDisplay: "/",
      browseAllDrives: false,
    }),
    fs: {},
    path: path.posix,
  });
  const result = service.listFiles("__roots__", "browse", ".pt");
  assert.equal(result.platform, "posix");
  assert.deepEqual(result.dirs, [{ name: "文件系统 /", path: "/" }]);
  assert.deepEqual(result.files, []);
});

test("virtual host browse prefix preserves Windows drive paths", () => {
  const service = createPathService({
    config: config({
      browseRoot: "C:\\",
      browseRootDisplay: "C:\\",
    }),
    fs: {},
    path,
  });
  assert.equal(
    service.toInternalDataPath("/host/browse/F:\\ZBH\\阿拉善数据合并-7月训练\\评估_8类映射_2000_20260723025559"),
    "F:\\ZBH\\阿拉善数据合并-7月训练\\评估_8类映射_2000_20260723025559",
  );
  assert.equal(
    service.toInternalDataPath("/host/browse/F:/ZBH/阿拉善数据合并-7月训练/评估_8类映射_2000_20260723025559"),
    "F:\\ZBH\\阿拉善数据合并-7月训练\\评估_8类映射_2000_20260723025559",
  );
});
