# 缩短发布停服窗口的备份顺序

`release-backup.py` 将冻结与归档拆开。它不是自动部署命令；现有镜像预检、任务空闲检查、原配置备份、就绪检查和镜像回退仍须执行。

1. 在服务正常运行时完成候选构建、拉取、隔离验收及回退准备。
2. 确认任务和写入空闲，正常停止唯一 Web 实例。执行冻结：

   `python3 ops/release-backup.py freeze "$DATA_DIR" "$RELEASE_DIR/frozen-data" --stopped-container "$WEB_CONTAINER"`

   命令检查容器已停止，将整个资料目录复制到新目录，逐文件核对源与副本。路径不得嵌套、使用符号链接或硬链接。失败保留现场并中止切换；资料原件不修改。
3. 冻结通过后切换镜像、启动服务并检查就绪、配置与挂载。不得同时启动两个共享同一 SQLite 的写入实例。
4. 服务恢复后执行归档：

   `python3 ops/release-backup.py archive "$RELEASE_DIR/frozen-data" "$RELEASE_DIR/data.tar.gz"`

   只压缩冻结副本；逐项校验归档与 SQLite 完整性，生成 SHA-256，再上传归档和校验文件。归档失败保留副本，标记备份交付未完成；不要为了归档或上传失败再次停止健康服务。开始下一次发布前必须补齐备份交付。
5. 切换前在单独终端运行 `python3 ops/release-backup.py probe "$LOOPBACK_BASE/api/auth/me" "$RELEASE_DIR/availability.json" --seconds 60`。它只接受明确的本机只读鉴权入口，将 200/401 视作服务可达，记录每次状态及最长观测不可用窗口；不得复用已有输出文件。持续记录停止到就绪期间的 API 探测，而非只记录最后一次 200。压缩和 OSS 上传时间不应计入停服窗口。

冻结副本、清单、归档和校验文件限制为当前用户可读。历史备份与旧镜像保留。此工具不恢复数据库、不删除副本，也不自动上传或改变线上配置。镜像回退须核对格式兼容性，不能覆盖发布后新增资料。

`node --test ops/release-backup.test.mjs` 验证副本在服务资料继续变化后仍可归档、篡改检测和不安全路径拒绝。真实停服时长须在获准发布后测量；合成数据的本地耗时不能当作生产承诺。
