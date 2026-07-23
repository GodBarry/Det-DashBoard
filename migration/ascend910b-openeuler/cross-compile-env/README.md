# ARM64 交叉编译环境

该目录用于本机 ARM64 源码和 ABI 预检，不替代服务器原生编译。

```powershell
. .\setup-cross-env.ps1
& $env:CC --version
& $env:CXX --version
```

完整 MMCV wheel 还需要从目标服务器导出匹配的 Python 3.9、PyTorch、torch_npu 和 CANN headers/libs；最终产物必须在服务器 ARM64 上做导入和推理验证。
