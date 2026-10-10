# Web/API 契约

所有路径以 `/study-log` 开头。当前客户端契约版本为 1；鸿蒙迁移时以实际路由和协议测试核对本文，发现差异先修正文档或实现，再接入客户端。[独立目录自行试装](self-install-2026-10-06.md)已完成列明流程；第三方鸿蒙签名安装和异网络受信 HTTPS 仍待验，接口测试不能替代这些结果。

## 认证与身份

- `POST /api/auth/login` 接收 `{password}`；正确返回 `{ok:true}` 并设置 HttpOnly、SameSite=Lax 会话Cookie；错误/畸形密码返回401，不回显输入。
- `POST /api/auth/app-login` 接收同样参数，返回 `{ok:true,token,expiresAt}`；后续用 `Authorization: Bearer …`。Cookie与App Token有不同受众，不互相替用。
- `GET /api/auth/me` 返回认证状态。`POST /api/auth/logout` 清除当前浏览器Cookie，不撤销其他已签发Token。
- `GET /api/capabilities` 需要认证，返回持久 `instanceId`、`apiContractVersion:1`、`serverVersion`（服务端产品版本）、`aiConfiguration` 和 `features`。`aiWriting`、`aiHighlighting`、`aiNoteExtraction`、`aiTaxonomy`、`rag` 均已实现，`supported` 为 true；各项 `configured` 由实例模型、对应模板及问答所需 MCP 配置分别决定，不代表上游服务连通或结果质量。
- `serverVersion` 从服务端包版本读取，仅用于展示，不替代 `apiContractVersion` 兼容检查；旧服务器可能不返回此字段，客户端应显示“未提供”，不能猜测版本。
- 认证有效期7天。过期、错误签名、额外分段或错误受众不能访问受保护API。Cookie Secure由实例配置明确指定，本地HTTP初始化默认false；HTTPS部署应设true。

配置及初始化错误不得包含密码、密钥或资料正文。实例身份不随服务重启改变。

## 日志生成方案

日志生成的 `POST /api/ai/generate` 另接受可选 `presetId`。省略或传 `legacy` 时继续使用实例 `generation.md`；默认方案只决定新界面的初始选择，不改变旧客户端请求。不存在的方案返回 404 `GENERATION_PRESET_NOT_FOUND`。非 legacy 方案无需有效的 generation.md，但仍需已配置聊天提供方。

`features.aiWriting.configured` 保留原有“提供方与 generation.md 均有效”的含义。选择非 legacy 方案的客户端应检查 `aiConfiguration.provider.configured` 及所选方案是否有效，不因旧模板缺失而禁用有效方案；这仍不表示已验证模型服务连通。

`GET /api/ai/generation-presets` 返回 `{version,defaultPresetId,presets:[{id,name,prompt,readOnly,issue?}]}`，全部操作需认证。内置 ID 为 `builtin:daily`、`builtin:concepts`、`builtin:practice`，与 `legacy` 均只读；个人方案为 `user:<uuid>`。POST 接受 `{version,name,prompt}`；PATCH 接受 `{version,id,name,prompt}` 或独立的 `{version,defaultPresetId}`；DELETE 接受 `{version,id}`。写操作返回完整新快照，旧 version 返回 409 `GENERATION_PRESET_CONFLICT`，不覆盖既有内容；删除默认个人方案时原子回退到 legacy。

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
- POST `{action:"createGroup",name}` 返回 `{group}`，同名复用已有组。PATCH `{action:"renameGroup",groupId,name}` 改名，拒绝与其他组重名。
- 当前 Web 与鸿蒙客户端通过 PATCH `{action:"setGroup",id,groupId,selected:boolean}` 加入或移除一个分组，返回 `{favorite}`；在实例内队列中基于最新快照修改，保留其他组归属，重复同向操作幂等，目标分组已删除则拒绝。同一分组的相反操作按服务端执行顺序处理，不提供版本冲突提示。
- 兼容接口 PATCH `{id,groupIds:string[]}` 仍表示替换全部归属，去重并忽略已经不存在的组，返回 `{favorite}`。它没有版本前提：旧客户端提交过期数组可能覆盖其他客户端刚修改的归属，串行存储不能消除此语义风险；新客户端应使用上述单组操作。
- DELETE `?id=...` 取消收藏；DELETE `?groupId=...` 删除分组并解除归属，保留收藏，均返回 `{ok:true}`。两个删除目标不能同时提供。
- favorite包括date/month、原headingText/headingId、resolvedHeadingId、groupIds、level、createdAt/updatedAt、exists、sectionPreview（最多180字符）及sectionSearchText（最多12000字符）。解析原文时按标题ID与文字优先，再按同文字回退；原标题改名或删除仍保留收藏，exists为false。小节边界使用AST，不把围栏或引用里的伪标题当边界。
- 收藏仅持久化于显式实例data下的`.study-log-favorites.json`。实例内修改串行执行，通过同目录唯一临时文件、sync与rename原子替换；写入/替换失败保留旧JSON，损坏JSON或结构错误明确失败，不静默重建空集合。拒绝实例根或收藏文件符号链接。参数问题400，存储问题500且不回传路径。此队列不提供跨进程并发写入支持。

## 统计与手工分类

- `GET /api/stats?month=YYYY-MM` 返回 `{stats}`，月份须合法；省略时选择最近有日志月份（空库为当前上海月份）。按权威日块与根级H3计数，包含所有活动，不内置个人排除或领域推断。领域/标签比例、活跃天数及上月变化均从这些条目计算；entries的headingIndex是日内真实H3序号，重复标题来源定位应使用此序号。
- `GET /api/taxonomy` 返回 `{taxonomy,catalog}`。taxonomy含domains/mappings/updatedAt/version，空实例仅领域“其他”、空映射及null版本；catalog按历史标题整理标签、出现次数、月份和来源，提供显式映射标识。
- `PUT /api/taxonomy` 接受 `{domains,mappings,baseVersion}` 返回 `{taxonomy}`。baseVersion必填，空文件用null，已有文件用读取的SHA256版本；旧版本409 `TAXONOMY_CONFLICT`。删除自定义领域后，其映射归入“其他”；不重建个人默认领域。
- 以上均先认证、禁止缓存。参数400，存储错误500且隐藏路径。分类JSON位于显式实例data，读取与写入共用进程内队列；覆盖前在实例backups保留完整唯一备份，再通过临时文件sync和rename替换。分类建议接口见下文，建议经人工审核后才进入手工草稿。

## 随记

- `/api/notes` 各方法先认证且不缓存。GET返回 `{notes,years,tags}`；列表按updatedAt倒序，记录含id/title/body/insight/sources/tags/recordedAt/createdAt/updatedAt/year/version/displayTitle，年份/标签筛选项为 `{value,count}`。空实例返回空数组。
- POST接受 `{title?,body,insight?,sources?,tags?,recordedAt}` 返回 `{note}`。正文非空，标题最多120字符，来源最多30项、标签最多20项；记录时间按Asia/Shanghai解释，接受本地 `YYYY-MM-DDTHH:mm[:ss]` 或显式 `+08:00`，拒绝无效日期和未来时间。
- PATCH接受以上字段加 `{id,baseVersion}` 返回 `{note}`；DELETE接受JSON `{id,baseVersion}` 返回 `{ok:true}`。两者必须提供当前非空版本，旧版本409 `NOTE_CONFLICT`，不存在404；不因缺少版本而无条件覆盖。
- 正文和个人理解不能包含根级H2或字段保留H3标题，围栏/引用/列表里的示例不受此限制。权威资料为年度Markdown，更新仅重写目标记录；写前备份位于实例 `backups/notes/`。
- 请求格式错误400；存储格式或读写失败500且不回传路径。跨年中断标记存在时503 `NOTES_RECOVERY_REQUIRED`，停止正常随记读写。[恢复说明](notes-storage.md)解释标记、备份及核验顺序。跨年是两次原子替换加失败回滚，不是跨文件单次原子事务。

## 日块写入

- `PUT /api/logs/day` 先认证，接收 `{date,content,baseVersion,mode?:"replace"|"append"}`，返回 `{day:完整DayEntry}`。默认替换；append只向该日正文追加请求片段，同样参与版本比较，不绕过冲突校验。界面普通保存仍使用replace。
- `DELETE /api/logs/day` 接收 `{date,baseVersion:非空字符串}`，版本不符或日块已消失返回409；成功返回 `{day:exists为false的空日块}`。只删除选中日，保留其他日原文和备份，不删除整个年月文件。
- `baseVersion`字段必须存在，类型为非空字符串或null。null仅断言目标日块不存在，允许向已有月/年文件中插入新日；队列内若发现目标日已存在则409。字符串要求目标日仍存在，且整份源文件版本一致；日块已删除或别日改动导致版本变化都返回409，不自动覆盖。
- GET空日仍返回`exists:false,version:null`；它不预留日期。保存以目标日实际所属源文件优先，其次已有月文件、已有年文件，均无才新建月文件；以保存响应的`fileName`为准。
- 只修改目标日块，日期标题和结构分隔符由服务端维护；拒绝未来日期、畸形请求或正文中的根级二级标题，返回400。成功返回正文及版本来自同一写入快照，读取与写入均不缓存。
- 保存前对最终日块的根级三级小节可见标题去数字编号后判重；覆盖和追加均适用。重复时返回包含标题的400错误，不写源文件或备份。已有重名资料仍可读取，须消除重复后才能再次保存该日块；代码围栏、引用等示例标题不参与判重。
- 实例内写入串行执行；覆盖已有源文件前，将完整旧快照写入显式`BACKUP_ROOT`（启动器固定为实例`backups/`）。备份文件含随机UUID并以独占创建方式写入，不会同秒覆盖。新内容通过同目录临时文件和原子rename替换；写入失败保留原文及已生成的备份。
- 409返回`code:"LOG_CONFLICT"`；文件系统故障返回500，不回传绝对路径。外部工具不应在服务运行期间直接改写资料；应用队列不构成跨任意进程的文件事务。

## 附件读取边界

`GET /api/assets/...` 先认证，再解析显式实例下的附件路径。拒绝目录联接、符号链接、路径越界和Windows备用数据流；打开后复核路径与文件身份。图片返回对应MIME及`nosniff`，SVG使用禁止脚本的sandbox；不缓存认证资料。

`POST /api/assets/upload` 先认证，接收 multipart/form-data 的多个 `file`，`scope` 可省略或为 `logs`；随记传 `scope=notes` 及四位 `year`（1000–9999）。每批1–10张，每张非空且不超过20 MiB；支持PNG/JPEG/WebP/GIF/BMP/SVG的MIME和扩展名，检查文件元数据，不解码或重编码图片。整个请求体最多201 MiB（含表单开销），实际流超过限制也拒绝；大小超限413，类型/数量/格式错误400。

整批校验通过后才创建文件；日志写入显式实例 `data/assets/`，随记写入 `data/assets/notes/YYYY/`，逐级拒绝符号链接/联接。服务端生成时间戳加UUID文件名，并独占创建，不使用用户文件名作为磁盘路径、不覆盖已有附件。成功返回 `{assets:[{fileName,path,markdown}]}`，日志 `path` 为 `./assets/文件名`，随记为相对年度随记文件的 `../assets/notes/YYYY/文件名`。失败尽量清理本批创建且身份仍可确认的文件，文件系统错误500不包含绝对路径。成功上传后若编辑器未保存，附件仍保留；不提供自动清理或远程对象存储。

## 资料导出

`GET /api/export?scope=day|file|all|notes[&date=YYYY-MM-DD]` 先认证，成功返回ZIP、`Content-Disposition`的UTF-8文件名、`no-store`及`X-Export-Warning-Count`。day/file必须提供合法日期；day导出该日Markdown，file导出其所在完整年/月文件，all导出全部源日志，notes导出年度随记并去除真正记录的元数据注释。代码示例里的注释保持原样。

各范围仅打包相关Markdown及其引用的本地图片，导出副本中的API或绝对站内图片地址改为可离线解析的相对地址。all不包含随记、会话、收藏或配置；原实例不被修改。此接口导出已保存资料，不包含编辑器草稿，也不是整实例备份。

仅缺失附件允许继续：计入警告数量，并在ZIP内加入`导出说明.txt`。目录越界或链接附件拒绝400；其他读取错误500，源文件在导出期间变化409，日块不存在404，随记待恢复503。错误不回传本机路径。

## 材料解析

材料解析的请求、返回和资源限制见 [材料解析](materials.md)。

## AI 生成草稿

`POST /api/ai/generate` 先认证，JSON `{date,material?,extractedText?,instruction?,presetId?}` 中日期必须有效且不在未来，文本字段不得用其他类型代替；材料和提取文本合计最多120,000字符，要求最多4,000字符，实际请求体最多800,000字节。至少一项文本非空。超过60,000字符的材料只发送前60,000字符并返回警告。

成功返回 `{result:{content,model,warnings}}`，仅提供草稿，不修改日志或备份。模型参考来自同一实例的当日内容（最多12,000字符）及最近最多30个有日志日的限量H3标题，不发送其他日正文。提示词按所选生成方案读取；省略 `presetId` 或使用 `legacy` 时从实例 `data/prompts/generation.md` 读取。结果仅去除无歧义的外层Markdown围栏和顶部同日标题，保留缩进、代码及个人排版选择；多日期、H1/H2、错误结构或未闭合根围栏会失败，不擅自改写成可保存稿。

共享聊天传输使用显式配置的完整端点，90秒期限、最多1 MiB响应并禁止HTTP重定向；支持请求取消。错误含安全的 `error` 和 `code`，不返回供应商原始正文、地址或凭据。输入400、请求过大413、限流429、取消499、配置/模板503、超时504，供应商认证/网络/无效输出502。`aiConfiguration` 是本地配置检查，不代表供应商连通或质量验证。

## AI 重点标注

`POST /api/ai/bold-highlights` 接收 `{date,content}`，正文最多 60,000 字符，日期必须有效且不在未来。返回 `{result:{content,model,boldCount,warnings}}`。模型只选择服务端提供的片段内 token 范围；服务端仅向普通正文插入粗体标记，标题、代码、公式、链接、图片和已有粗体受保护。无安全范围时返回原文与提示。

接口不读取或写入该日日志。客户端审阅后应用前须再次核对日期和原文快照；应用只进入编辑草稿。鉴权、取消、配置错误和上游失败沿用生成接口的状态码与安全错误，不返回模型服务凭据或原始错误正文。

## 随记候选与分类建议

`POST /api/notes/candidates` 接收 `{documents: ExtractedDocument[]}`（先调用材料解析，最多5份、合计160,000字符/2,000片段、JSON请求2 MiB）。返回 `{result:{candidates,documents,warnings,model}}`，最多12条候选，候选 `id` 是可直接用于批量保存的 UUID；含标题/正文/个人理解/来源/标签、明示或归纳类型，以及来自所给材料实际片段的依据。依据证明的是所提交材料中的文字，不代表已核实外部来源。提取不写随记。

`POST /api/notes/batch` 接收 `{notes:[{clientId,title,body,insight,sources,tags,recordedAt}]}`，每批1–20条、请求4 MiB；返回 `{notes:StudyNote[]}`，与输入顺序一致。全批校验后统一写入。相同 UUID 与相同规范化业务内容重试返回原记录，不重复备份；同 UUID 不同内容返回409 `NOTE_CONFLICT`。跨年份失败走随记存储的回滚/恢复标记，不宣称多文件原子事务。客户端应核对返回记录身份后清稿，未确认时保留原批次重试。

`POST /api/taxonomy/suggest` 接收 `{mode?:"organize",items:[{tag,sources?}]}`，最多200个主题，按50个分批请求。公开版客户端使用 `organize`：服务端排除已有精确或继承映射，优先复用现有领域，允许根据主题提出最多8个新领域（名称1–40字符）；分批时携带前批领域，避免重复建立。返回 `{proposedDomains,suggestions,warnings,model,snapshotVersion}`，无对应有效建议的领域不返回。空分类可直接请求；全部已有分类则不调用模型。建议不写分类，客户端核验快照后审核，仅把已采纳归类使用的新领域合入草稿，再调用既有版本化保存接口。未配置模型返回现有503配置错误，不会生成或写入空分类。省略 `mode` 的旧客户端仍按已保存领域获取建议，仅“其他”时不调用模型。

统计主题保留标题括号内容，省略小节序号和多余空白。完整键优先；缺少完整键时兼容旧版去括号映射，读取不改写旧分类文件。`MonthlyStats.classificationReady` 为可选追加布尔字段，本版服务端始终返回；为false时显示未整理领域，记录天数、小节计数、日历和主题频次照常可用。

## 日块备份

- `GET /api/backups?date=YYYY-MM-DD&cursor=...` 返回 `{backup:{write:[{id,kind:"write",createdAt,sizeBytes,fileName}],nextCursor}}`；cursor可省略。按内容去重，最多最近20个不同日块版本，每请求最多读取64个候选文件；nextCursor非空时可继续。物理备份不因列表上限而删除。
- `GET /api/backups/preview?date=...&kind=write&id=...` 返回 `{preview:{date,kind,id,fileName,historicalContent,currentContent,currentVersion,backupVersion}}`。backupVersion是历史日块内容摘要，预览用于比较，不修改资料。
- `POST /api/backups/restore` 接收 `{date,kind:"write",id,baseVersion,backupVersion}`。baseVersion使用预览时的currentVersion，字段不可省略；已删除日可为null。双方版本任一变化返回409，须重新预览并确认。成功返回 `{day}`。
- 恢复经过普通写入的串行队列、写前备份和原子替换，仅复制历史中的选中日。当前已有日保持实际所属文件；恢复缺失日优先回历史年月源文件，不覆盖其他日。损坏/重复日期备份拒绝恢复。
- 以上入口均须认证；备份ID严格限制为所选日期对应的年/月文件名和备份格式，不接受路径。未找到版本404，参数400，文件系统错误500且不泄露路径；所有响应禁止缓存。日块备份不同于已实现的停机整实例归档恢复，后者见[整实例备份与恢复](backup-restore.md)。

## 日志问答与历史

`POST /api/rag/query` 使用 SSE 返回 `status`、`sources`、`delta`、`done` 或 `error`；只有 `done` 表示完整回答。会话列表、创建、读取、更新、命名和删除由 `/api/rag/sessions` 及其子路径提供，写入携带版本及操作标识。请求结构、引用和失败恢复见[日志问答](rag.md)。客户端不得将连接提前结束当成成功，也不得将随记或 Wiki 当成日志证据。
