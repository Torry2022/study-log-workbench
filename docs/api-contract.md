# Web/API 契约（实施中）

所有路径以 `/study-log` 开头。当前契约版本1尚在逐项实现，未达到完整冻结门槛。

## 认证与身份

- `POST /api/auth/login` 接收 `{password}`；正确返回 `{ok:true}` 并设置 HttpOnly、SameSite=Lax 会话Cookie；错误/畸形密码返回401，不回显输入。
- `POST /api/auth/app-login` 接收同样参数，返回 `{ok:true,token,expiresAt}`；后续用 `Authorization: Bearer …`。Cookie与App Token有不同受众，不互相替用。
- `GET /api/auth/me` 返回认证状态。`POST /api/auth/logout` 清除当前浏览器Cookie，不撤销其他已签发Token。
- `GET /api/capabilities` 需要认证，返回持久 `instanceId`、`apiContractVersion` 和 `features`。当前AI/问答尚未实现，`supported/configured` 都为false；不得将未实现能力报告为可用。
- 认证有效期7天。过期、错误签名、额外分段或错误受众不能访问受保护API。Cookie Secure由实例配置明确指定，本地HTTP初始化默认false；HTTPS部署应设true。

配置及初始化错误不得包含密码、密钥或资料正文。实例身份不随服务重启改变。

## 只读日块

- `GET /api/logs/months` 返回 `{months:[{id,label,dayCount,firstDate,lastDate}]}`，按月倒序。
- `GET /api/logs?month=YYYY-MM` 返回 `{days:[{date,month,fileName,headings,preview}]}`，按日期倒序；空月为空数组。
- `GET /api/logs/day?date=YYYY-MM-DD` 返回 `{day:{...summary,exists,content,version,updatedAt}}`；不存在的日块返回 `exists:false`、日期标题及 `version:null`，不创建文件。
- 所有读取需要认证，响应禁止缓存；无效日历日期或月份返回400。源文件日块必须属于文件名的年/月，日期不能重复；不合规资料明确读取失败，不猜测应选哪份。
- 日块和版本哈希来自同一原文快照。源文件采用 `YYYY_学习日志.md` 或 `YYYY-MM_学习日志.md`；只识别根级ATX日期标题，代码、列表和引用中的示例不会分割日块，目录小节同样忽略代码示例。

## 普通日志搜索

普通日志搜索使用 `GET /api/search?q=查询&scope=all|heading&ignoreCase=true|false`，先认证，默认全文及忽略大小写。查询去除首尾空白后按字面子串逐行匹配，空查询返回空结果；不支持正则、语义检索或RAG。`heading`只检索AST确认的根级三级标题，代码、引用及列表中的伪标题不计入标题；全文仍可检索代码示例。

返回 `{results:[{date,month,fileName,headings,matches}]}`，每个命中日块一项，日期倒序，`matches`按原文顺序最多5行并去除行首尾空白，`headings`保留真实三级标题并去除可选数字编号。`fileName`和正文来自同次权威源文件读取，保留真实年/月文件名。非法范围/大小写参数400，资料读取失败500且不暴露文件路径；响应不缓存。

## 小节收藏与分组

- 所有 `/api/favorites` 方法先认证且禁止缓存。GET返回 `{favorites,groups}`，来自同一收藏JSON快照；收藏按创建时间倒序，分组按order升序。空实例两个数组均为空，不预置个人分组。
- POST接收 `{date,headingText,headingId,level:3}` 返回 `{favorite}`；相同日期、标题和标题ID重复收藏保持同一id与createdAt。只支持真实产品已有的三级小节收藏，date负责定位原日块，不提供整日收藏。
- POST `{action:"createGroup",name}` 返回 `{group}`，同名复用已有组。PATCH `{action:"renameGroup",groupId,name}` 改名，拒绝与其他组重名；PATCH `{id,groupIds:string[]}` 更新多组归属，去重并忽略已经不存在的组，返回 `{favorite}`。
- DELETE `?id=...` 取消收藏；DELETE `?groupId=...` 删除分组并解除归属，保留收藏，均返回 `{ok:true}`。两个删除目标不能同时提供。
- favorite包括date/month、原headingText/headingId、resolvedHeadingId、groupIds、level、createdAt/updatedAt、exists、sectionPreview（最多180字符）及sectionSearchText（最多12000字符）。解析原文时按标题ID与文字优先，再按同文字回退；原标题改名或删除仍保留收藏，exists为false。小节边界使用AST，不把围栏或引用里的伪标题当边界。
- 收藏仅持久化于显式实例data下的`.study-log-favorites.json`。实例内修改串行执行，通过同目录唯一临时文件、sync与rename原子替换；写入/替换失败保留旧JSON，损坏JSON或结构错误明确失败，不静默重建空集合。拒绝实例根或收藏文件符号链接。参数问题400，存储问题500且不回传路径。此队列不提供跨进程并发写入支持。

## 日块写入

- `PUT /api/logs/day` 先认证，接收 `{date,content,baseVersion,mode?:"replace"|"append"}`，返回 `{day:完整DayEntry}`。默认替换；append只向该日正文追加请求片段，同样参与版本比较，不绕过冲突校验。界面普通保存仍使用replace。
- `DELETE /api/logs/day` 接收 `{date,baseVersion:非空字符串}`，版本不符或日块已消失返回409；成功返回 `{day:exists为false的空日块}`。只删除选中日，保留其他日原文和备份，不删除整个年月文件。
- `baseVersion`字段必须存在，类型为非空字符串或null。null仅断言目标日块不存在，允许向已有月/年文件中插入新日；队列内若发现目标日已存在则409。字符串要求目标日仍存在，且整份源文件版本一致；日块已删除或别日改动导致版本变化都返回409，不自动覆盖。
- GET空日仍返回`exists:false,version:null`；它不预留日期。保存以目标日实际所属源文件优先，其次已有月文件、已有年文件，均无才新建月文件；以保存响应的`fileName`为准。
- 只修改目标日块，日期标题和结构分隔符由服务端维护；拒绝未来日期、畸形请求或正文中的根级二级标题，返回400。成功返回正文及版本来自同一写入快照，读取与写入均不缓存。
- 实例内写入串行执行；覆盖已有源文件前，将完整旧快照写入显式`BACKUP_ROOT`（启动器固定为实例`backups/`）。备份文件含随机UUID并以独占创建方式写入，不会同秒覆盖。新内容通过同目录临时文件和原子rename替换；写入失败保留原文及已生成的备份。
- 409返回`code:"LOG_CONFLICT"`；文件系统故障返回500，不回传绝对路径。外部工具不应在服务运行期间直接改写资料；应用队列不构成跨任意进程的文件事务。

## 附件读取边界

`GET /api/assets/...` 先认证，再解析显式实例下的附件路径。拒绝目录联接、符号链接、路径越界和Windows备用数据流；打开后复核路径与文件身份。图片返回对应MIME及`nosniff`，SVG使用禁止脚本的sandbox；不缓存认证资料。

`POST /api/assets/upload` 先认证，接收 multipart/form-data 的多个 `file`，`scope` 可省略或为 `logs`。每批1–10张，每张非空且不超过20 MiB；支持PNG/JPEG/WebP/GIF/BMP/SVG的MIME和扩展名，检查文件元数据，不解码或重编码图片。整个请求体最多201 MiB（含表单开销），实际流超过限制也拒绝；大小超限413，类型/数量/格式错误400。

整批校验通过后才创建文件；仅写入显式实例 `data/assets/`，拒绝实例根及附件目录符号链接/联接。服务端生成时间戳加UUID文件名，并独占创建，不使用用户文件名作为磁盘路径、不覆盖已有附件。成功返回 `{assets:[{fileName,path,markdown}]}`，其中 `path` 为 `./assets/文件名`，可直接写入日志Markdown。失败尽量清理本批创建且身份仍可确认的文件，文件系统错误500不包含绝对路径。成功上传后若编辑器未保存，附件仍保留；本批不提供自动清理、随记上传或远程对象存储。

## 日块备份

- `GET /api/backups?date=YYYY-MM-DD&cursor=...` 返回 `{backup:{write:[{id,kind:"write",createdAt,sizeBytes,fileName}],nextCursor}}`；cursor可省略。按内容去重，最多最近20个不同日块版本，每请求最多读取64个候选文件；nextCursor非空时可继续。物理备份不因列表上限而删除。
- `GET /api/backups/preview?date=...&kind=write&id=...` 返回 `{preview:{date,kind,id,fileName,historicalContent,currentContent,currentVersion,backupVersion}}`。backupVersion是历史日块内容摘要，预览用于比较，不修改资料。
- `POST /api/backups/restore` 接收 `{date,kind:"write",id,baseVersion,backupVersion}`。baseVersion使用预览时的currentVersion，字段不可省略；已删除日可为null。双方版本任一变化返回409，须重新预览并确认。成功返回 `{day}`。
- 恢复经过普通写入的串行队列、写前备份和原子替换，仅复制历史中的选中日。当前已有日保持实际所属文件；恢复缺失日优先回历史年月源文件，不覆盖其他日。损坏/重复日期备份拒绝恢复。
- 以上入口均须认证；备份ID严格限制为所选日期对应的年/月文件名和备份格式，不接受路径。未找到版本404，参数400，文件系统错误500且不泄露路径；所有响应禁止缓存。当前仅实现本机写前备份，整实例恢复在后续批次实现。
