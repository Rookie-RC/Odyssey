// 简体中文 strings for the Manage Atlas utility and Direct Edit (keyed by the
// English source text, see i18n.ts). Kept apart from the Atlas dictionary
// because the utility vocabulary is larger and more technical. Keys already in
// i18n-zh.ts (Cancel, Remove, Name, Edit, seasons, visit types…) are not
// repeated here — on a clash the Atlas dictionary wins.
export const ZH_MANAGE: Record<string, string> = {
  // --- settings: language ---
  Language: "语言",
  "Interface language. Your own words — place names, reflections, notes — are always shown as you wrote them.":
    "界面语言。你自己写下的内容——地名、感想、笔记——始终按原样显示。",

  // --- shell / navigation ---
  Overview: "概览",
  Visits: "到访",
  Media: "媒体",
  "Import / Export": "导入 / 导出",
  Settings: "设置",
  "Manage sections": "管理分区",
  "Back to Atlas": "返回地图集",
  "I've been here": "我去过这里",
  "I want to go here": "我想去这里",
  "+ I've been here": "+ 我去过这里",
  "+ I want to go here": "+ 我想去这里",
  "Edit visit": "编辑到访",
  "Edit wishlist": "编辑心愿",
  "Edit place": "编辑地点",

  // --- common actions ---
  Save: "保存",
  Delete: "删除",
  Confirm: "确认",
  "Confirm delete": "确认删除",
  Clear: "清除",
  "+ Add": "+ 添加",
  "Loading…": "加载中…",

  // --- place types (lib/places.ts labels) ---
  City: "城市",
  Region: "地区",
  Island: "岛屿",
  "Natural area": "自然区域",

  // --- add flow ---
  "Search and select a location first.": "请先搜索并选择一个地点。",
  "Visit saved · new place created.": "到访已保存 · 已新建地点。",
  "Visit saved · existing place reused.": "到访已保存 · 已复用现有地点。",
  "Wishlist saved · new place created.": "心愿已保存 · 已新建地点。",
  "Wishlist saved · existing place reused.": "心愿已保存 · 已复用现有地点。",
  "Record a visit — the Atlas adds the place to the map and timeline.":
    "记录一次到访——地图集会把这个地点加到地图和时间线上。",
  "Save a future destination — it appears in Where Next and the timeline when timed.":
    "保存一个未来的目的地——它会出现在“下一站”中，设定时间后也会出现在时间线上。",

  // --- entity editor ---
  "place not found": "找不到该地点",
  "name is required": "名称不能为空",
  "pick a location on the map": "请在地图上选择位置",
  "a location is required": "需要选择一个地点",
  "Place updated.": "地点已更新。",
  "Visit updated.": "到访已更新。",
  "Visit updated · new place created.": "到访已更新 · 已新建地点。",
  "Wishlist updated.": "心愿已更新。",
  "Wishlist updated · new place created.": "心愿已更新 · 已新建地点。",
  "Search to update location": "搜索以更新位置",
  "Optional — search and pick a result to update name, country and coordinates together.":
    "可选——搜索并选择一个结果，即可同时更新名称、国家和坐标。",
  Country: "国家",
  "Search above to change the country (code: {code}).": "在上方搜索以更改国家（代码：{code}）。",
  Type: "类型",
  Location: "位置",
  "Drag the marker or click the map to refine the coordinates.": "拖动标记或点击地图以微调坐标。",

  // --- location picker ---
  "Search location": "搜索地点",
  "Search for a city, region, island or natural area.": "搜索城市、地区、岛屿或自然区域。",
  "e.g. Lofoten, Sardinia, Dolomites…": "例如：罗弗敦群岛、撒丁岛、多洛米蒂山…",
  "No destination-scale results. Try a city, region or island.": "没有目的地级别的结果。试试城市、地区或岛屿。",
  "Can’t find it? Pick on map instead": "找不到？改为在地图上选点",
  "Clear location": "清除地点",
  "Existing place reused — no duplicate will be created.": "已复用现有地点——不会创建重复项。",
  "To change this place’s location or type, edit it in Manage → Places.":
    "如需更改此地点的位置或类型，请在“管理 → 地点”中编辑。",
  "Place type": "地点类型",
  "Manually correct the type if the provider's guess is off.": "如果服务商猜测的类型不对，可在此手动更正。",
  "Pick a location on the map, then name it.": "在地图上选择位置，然后为它命名。",
  "Back to search": "返回搜索",
  "Place name": "地点名称",
  "Optional, but helps the Atlas show context.": "可选，但有助于地图集显示背景信息。",
  "Click the map to place a pin.": "点击地图放置标记。",

  // --- mini map ---
  "Drag the marker or click the map to refine the location.": "拖动标记或点击地图以微调位置。",
  "Toggle attribution": "显示 / 隐藏版权信息",
  "Map marker": "地图标记",

  // --- overview ---
  "Everything is stored locally in your atlas-data folder — no files to edit by hand.":
    "所有内容都保存在本地的 atlas-data 文件夹中——无需手动编辑任何文件。",
  "Add to your Atlas": "添加到地图集",
  "Search for a place online — the Atlas fills in the country, coordinates and place type for you.":
    "在线搜索地点——地图集会自动为你填好国家、坐标和地点类型。",
  "No current base": "未设置当前所在地",
  "Set where you live in Profile → Edit profile. It becomes the pulsing marker on the map and the NOW anchor on the Timeline.":
    "在“个人主页 → 编辑资料”中设置你的居住地。它会成为地图上跳动的标记，以及时间线上的“现在”锚点。",
  "Polish your Atlas": "完善你的地图集",
  "Nothing missing — every memory has a date, a photo and a story.": "没有遗漏——每段回忆都有日期、照片和故事。",
  "+{n} more": "还有 {n} 个",
  "Memories without a photo": "没有照片的回忆",
  "They show as a plain tile on the Timeline.": "它们在时间线上只会显示为素色卡片。",
  "Memories without a date": "没有日期的回忆",
  "They sit at the far left of the Timeline as “Earlier” and draw no route.":
    "它们会以“更早”排在时间线最左侧，也不会绘制路线。",
  "Memories without a story": "没有故事的回忆",
  "No highlights or reflection yet — the Detail Sheet will be quiet.": "还没有亮点或感想——详情页会显得很空。",
  "Wishes without a target time": "没有目标时间的心愿",
  "They live in Where Next but never appear on the Timeline's future side.":
    "它们会出现在“下一站”中，但永远不会出现在时间线的未来一侧。",
  "Wishes without an inspiration image": "没有灵感图片的心愿",
  "Where Next is photographic; an image makes the shelf sing.": "“下一站”以图片为主；有一张图，整排卡片都会生动起来。",
  "Places with no visit or wish": "没有到访或心愿的地点",
  "They exist but appear nowhere in the Atlas.": "它们虽然存在，却不会出现在地图集的任何地方。",

  // --- places ---
  "Place deleted.": "地点已删除。",
  "No places yet. Add your first visit or wishlist entry.": "还没有地点。添加你的第一次到访或第一个心愿吧。",
  "{n} visit": "{n} 次到访",
  "{n} visits": "{n} 次到访",
  "{n} wishlist": "{n} 个心愿",
  "no visits": "无到访",
  "current base": "当前所在",

  // --- visits ---
  "Visit removed.": "到访已删除。",
  "No visits recorded yet.": "还没有记录任何到访。",
  "(missing place)": "（地点缺失）",
  "with friends": "与朋友同行",
  "{n} highlight": "{n} 个亮点",
  "{n} highlights": "{n} 个亮点",
  "{n} photo": "{n} 张照片",
  "{n} photos": "{n} 张照片",

  // --- wishlist ---
  "Wishlist item removed.": "心愿已删除。",
  "No wishlist entries yet.": "还没有心愿。",
  "Priority {n}": "优先级 {n}",
  "No priority": "无优先级",
  "any season": "不限季节",
  "on timeline": "在时间线上",
  "not on timeline (no target time)": "不在时间线上（无目标时间）",

  // --- visit form ---
  "Visit type": "到访类型",
  "How deep was the visit? This shapes the Atlas story.": "这次到访有多深入？这会影响地图集讲述的故事。",
  "Start date": "开始日期",
  "End date": "结束日期",
  "Memorable moments, not exhaustive itineraries.": "值得记住的瞬间，而不是面面俱到的行程。",
  "Highlight name": "亮点名称",
  "Note (optional)": "备注（可选）",
  "Remove highlight": "移除亮点",
  "+ Add highlight": "+ 添加亮点",
  Reflection: "感想",
  "What do you remember about being there?": "关于那里，你还记得什么？",
  Photos: "照片",

  // --- wishlist form ---
  "Best seasons": "最佳季节",
  "Where Next groups destinations by season.": "“下一站”会按季节为目的地分组。",
  "Target year (optional)": "目标年份（可选）",
  "e.g. 2027": "例如 2027",
  "Target season (optional)": "目标季节（可选）",
  Priority: "优先级",
  "1 = highest. Used to rank Where Next.": "1 为最高。用于“下一站”的排序。",
  "Short display-oriented reason.": "用于展示的简短理由。",
  "e.g. Midnight sun, dramatic mountains and hiking.": "例如：午夜阳光、壮观的山峦和徒步。",
  Inspirations: "灵感",
  "Remove inspiration": "移除灵感",
  Title: "标题",
  Creator: "创作者",
  "Platform (e.g. YouTube)": "平台（例如 YouTube）",
  URL: "网址",
  "+ Add inspiration": "+ 添加灵感",
  "Free-form personal planning thoughts.": "随手记下的个人计划想法。",
  "Maybe 2027 or 2028. Could go with friends…": "也许 2027 或 2028 年。可以和朋友一起去…",
  Images: "图片",

  // --- media ---
  "Media uploaded.": "媒体已上传。",
  "Media deleted.": "媒体已删除。",
  "Media metadata updated.": "媒体信息已更新。",
  "Store under place (optional)": "存放到地点下（可选）",
  misc: "misc（未分类）",
  "+ Upload photos": "+ 上传照片",
  "Drag photos here, or click to choose. Stored under atlas-data/media.":
    "将照片拖到这里，或点击选择。文件保存在 atlas-data/media 中。",
  "No media yet.": "还没有媒体。",
  "No media yet — upload the first image below.": "还没有媒体——在下方上传第一张图片吧。",
  Untitled: "未命名",
  "no author": "无作者",
  web: "网络",
  "not referenced": "未被引用",
  "Still referenced — remove it from the visit/wishlist first.": "仍被引用——请先从到访或心愿中移除。",
  Caption: "说明",
  Author: "作者",
  License: "许可",
  "Source URL": "来源网址",
  "{n} photo uploaded; then failed: {error}": "已上传 {n} 张照片，随后失败：{error}",
  "{n} photos uploaded; then failed: {error}": "已上传 {n} 张照片，随后失败：{error}",

  // --- direct edit ---
  "No photos associated yet.": "还没有关联照片。",
  "Caption for {caption}": "“{caption}”的说明",
  "Caption for photo": "照片说明",
  "Move earlier": "前移",
  "Move later": "后移",
  Cover: "封面",
  "Use as cover": "设为封面",
  "Remove from this place": "从此地点移除",
  "Remove photo": "移除照片",
  "Close media library": "关闭媒体库",
  "+ Add photos": "+ 添加照片",

  // --- settings ---
  "Appearance, the map's resting place, and sharing.": "外观、地图的默认位置，以及共享。",
  "Theme set to {name}.": "主题已设为{name}。",
  "Default map position (optional)": "默认地图位置（可选）",
  "The Hero Map opens here instead of Europe. Leave empty to keep the default.":
    "首页地图将在这里打开，而不是欧洲。留空则保持默认。",
  "Save map position": "保存地图位置",
  "Default map position saved.": "默认地图位置已保存。",
  "Default map position cleared.": "默认地图位置已清除。",
  Runtime: "运行时",
  "Data directory": "数据目录",
  "Geocoding provider": "地理编码服务",
  Mode: "模式",
  "(writable)": "（可写）",
  "(read-only)": "（只读）",
  "Configured provider": "已配置的服务",
  "Machine config lives in runtime-config.json.": "本机配置位于 runtime-config.json。",

  // --- import / export ---
  "Your whole Atlas travels as one portable .atlas file — structured data and media together. Backups are automatic before any replacement.":
    "整个地图集可以打包成一个便携的 .atlas 文件——结构化数据与媒体一并带走。任何替换操作之前都会自动备份。",
  "Export Atlas": "导出地图集",
  "Create a portable .atlas backup containing your data and media. The file is fully self-contained — enough to reconstruct the Atlas anywhere.":
    "创建一个包含数据与媒体的便携 .atlas 备份。该文件完全自包含——在任何地方都足以重建地图集。",
  Export: "导出",
  "Exporting…": "导出中…",
  "Packaging your Atlas…": "正在打包你的地图集…",
  "Export complete — the .atlas file was downloaded.": "导出完成——.atlas 文件已下载。",
  "Import Atlas": "导入地图集",
  "Replace the current Atlas with a .atlas file. A backup of the current Atlas is created automatically first; the package is validated before anything is replaced.":
    "用一个 .atlas 文件替换当前地图集。系统会先自动备份当前地图集，并在替换任何内容之前校验文件包。",
  "Choose file": "选择文件",
  "Importing…": "导入中…",
  "Validating and importing…": "正在校验并导入…",
  "Atlas imported. Backup: {backup}": "地图集已导入。备份：{backup}",
  "Atlas imported — a backup was created first.": "地图集已导入——导入前已创建备份。",
  "New Atlas": "新建地图集",
  "New Atlas…": "新建地图集…",
  "Start fresh with a blank Atlas — no files to create by hand. A backup of the current Atlas is created first, and your theme preference is kept.":
    "从一个空白地图集重新开始——无需手动创建任何文件。系统会先备份当前地图集，并保留你的主题偏好。",
  "Confirm — replace everything": "确认——替换全部内容",
  "Creating…": "创建中…",
  "Creating a blank Atlas…": "正在创建空白地图集…",
  "New Atlas created. Backup: {backup}": "新地图集已创建。备份：{backup}",
  "Started a new Atlas — a backup was created first.": "已开始新的地图集——开始前已创建备份。",
  Backups: "备份",
  "Taken automatically before every import, restore or New Atlas, and kept in your atlas-data/backups folder. Restoring one backs up the current Atlas first, so nothing is ever lost.":
    "每次导入、恢复或新建地图集之前都会自动备份，并保存在 atlas-data/backups 文件夹中。恢复备份时也会先备份当前地图集，因此不会丢失任何内容。",
  "No backups yet.": "还没有备份。",
  Restore: "恢复",
  "Confirm restore": "确认恢复",
  "Restored {name}. The Atlas you had before was backed up as {backup}.": "已恢复 {name}。之前的地图集已备份为 {backup}。",
  "Backup restored — your previous Atlas was backed up first.": "备份已恢复——之前的地图集已先行备份。",
  "Deleted backup {name}.": "已删除备份 {name}。",
};
