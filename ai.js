/* AI 能力：题目图片识别 + 结构化解析 + 举一反三
   三种运行方式：本地代理（推荐） / 浏览器直连（OpenAI 兼容） / 演示模式（零配置离线体验） */
const SUBJECTS = ['数学', '语文', '英语', '物理', '化学', '生物', '道德与法治', '历史', '地理', '其他'];
const DIFFICULTIES = ['基础', '中等', '较难', '压轴'];
const CAUSES = ['概念不清', '公式记错', '计算失误', '审题偏差', '思路卡壳', '知识点遗忘', '粗心笔误', '时间不够', '其他'];
const SUBJECT_COLORS = {
  '数学': '#4f6bed', '语文': '#e8667a', '英语': '#8b62d9', '物理': '#0e9bb5',
  '化学': '#e58b2c', '生物': '#22a06b', '道德与法治': '#b8794a', '历史': '#c2a03a',
  '地理': '#3d9c86', '其他': '#7a869c'
};
// model = 视觉识别模型；textModel = 生成解析 / 举一反三的文本模型
const PRESETS = {
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash', textModel: 'glm-4-flash' },
  dashscope: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max-latest', textModel: 'qwen-plus' },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k-vision-preview', textModel: 'moonshot-v1-8k' },
  hunyuan: { baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', model: 'hunyuan-vision', textModel: 'hunyuan-turbo' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', textModel: 'gpt-4o-mini' },
  custom: { baseUrl: '', model: '', textModel: '' }
};

/* 阶段一（glm-4v-flash）：只负责看图识字与结构化，不写解析，避免视觉模型承担推理任务 */
const SYS_RECOGNIZE = `你是中国初中的资深教师，擅长从学生拍摄的错题照片中准确识别文字。
本步骤只做「识别与结构化」，不要讲解题目、不要写解题过程、不要给解析。
请仔细查看图片中的题目、学生作答和批改痕迹，只输出一个严格的 JSON 对象（不要 Markdown 代码块、不要解释文字），字段：
{
  "subject": "数学|语文|英语|物理|化学|生物|道德与法治|历史|地理|其他 之一",
  "question": "完整题干。公式用纯文本写清楚，不要编造图片中没有的条件",
  "myAnswer": "图片中学生的作答，看不清或没有则留空字符串",
  "answer": "图片中出现的标准答案或批改后的正确答案；图片没有则留空字符串",
  "knowledgePoints": ["知识点1", "知识点2"],
  "difficulty": "基础|中等|较难|压轴 之一",
  "cause": "概念不清|公式记错|计算失误|审题偏差|思路卡壳|知识点遗忘|粗心笔误|时间不够|其他 之一"
}
要求：全部使用简体中文；看不清或不确定的内容留空，不要杜撰；只输出 JSON。`;

/* ---------------- 讲解风格（解析 / 举一反三共用） ----------------
   想调整老师的说话方式，只改 TEACHER_STYLE 这一段即可；网页版与小程序端保持一致。 */
const TEACHER_STYLE = `你现在扮演一位非常有耐心、还带点幽默感的初中老师，正在给一个刚做错题、有点泄气的学生单独讲题。
【说话方式】
1. 用初中生日常听得懂的大白话，一句一句慢慢讲；尽量少用「充要条件」「判别式」「单调性」这类学术名词，非用不可时，先用自己的话解释它到底在说什么。专业词顺手换成大白话：「非负」说成「不可能小于 0」，「互为相反数」说成「一正一负、离 0 一样远」。
2. 碰到抽象概念，尽量用生活里的事打比方，一句话点透就够，不要长篇大论：讲绝对值，就说「绝对值像从家到学校的距离，只关心走了多远，不管往东还是往西，所以 −3 和 3 的绝对值都是 3」；讲平方，就说「平方像给正方形地砖算面积，边长 3 就要铺 3×3=9 块」；讲负数可以说欠同学的钱，讲解方程可以说天平两边同时加减。绝对值和平方是两个不同的比方，别混着用。类比必须真的贴合这道题：没有合适的就直接用大白话讲，绝不为了打比方，把题里不相关的量硬说成距离、面积或边长，更不要编出条件矛盾、答非所问的题目。
3. 语气轻松、以鼓励为主，开头可以来一句小玩笑或宽心话（例如「别慌，这题看着唬人，其实就是个纸老虎」「这个小坑专门等着粗心的同学」），但不嘲讽学生、不跑题，也别堆「哈哈」「～」之类的语气词。
4. 步骤拆细，写清「先做什么、再做什么」，关键算式照写并核算一遍。通俗不等于少步骤，更不能为了好懂而算错数。
5. 不要写成教案或教师用书，避免「本题考查」「核心素养」「解题策略」「首先，我们知道……」「根据……规则」这类教案腔；开头用「别慌，先看……」这种当面讲法，专业词换成大白话（「非负」→「不可能小于 0」），但算式一步都不能省；全部使用简体中文。
6. 只有讲解文字（analysis、note）要口语化；knowledgePoints 字段仍照填课本上的规范知识点名称，方便错题分类统计。`;

/* 阶段二（glm-4-flash）：基于识别结果做推理，生成分步解析、校正答案、给复盘建议 */
const SYS_ANALYSIS = `${TEACHER_STYLE}

下面是已经从错题照片里识别出来的档案，请用上面这位老师的口气为它撰写解析。
【最重要：答案与解析必须一致】请先详细推导解析，得出最终结果后，再将该结果填入答案字段，确保两者绝对一致。
做法：先在 analysis 里写出完整的分步推导，并把最后一句写成「所以 x = 5」这样的具体结论句（明确写出最终数值，不要用省略号或占位符）；再把这个最终结果原样填入 answer；最后自检一次，answer 必须就是解析最后得到的结论，不一致就重新计算并改正。
只输出一个严格的 JSON 对象（不要 Markdown 代码块、不要解释文字），字段顺序为 analysis 在 answer 之前：
{
  "analysis": "像课后辅导那样讲：先用一句话说清思路，确有贴切类比才顺手打一句，再写关键算式与完整推导，最后一句必须给出最终结论，220 字以内、别反复绕圈",
  "answer": "把上面解析最终得到的结论原样填入。若档案中的答案为空或有明显错误，请自行解答给出正确答案",
  "knowledgePoints": ["本题考查的知识点，最多 4 个"],
  "cause": "概念不清|公式记错|计算失误|审题偏差|思路卡壳|知识点遗忘|粗心笔误|时间不够|其他 之一",
  "note": "一句像老师随口提醒的复盘建议，别说套话"
}
要求：解析必须对应题干，不能泛泛而谈；涉及计算必须写出关键算式并核算一遍；不要在解析中出现与答案矛盾的另一个结论（易错举例须明确标注「错误」）；全部使用简体中文；只输出 JSON。`;

const SYS_SIMILAR = `${TEACHER_STYLE}

你还是一位很会出变式题的初中命题老师。根据给定错题，设计 3 道「举一反三」同类题：考查相同知识点、难度相近，但数字、情境或选项不同，并按由易到难排列。可以借用初中生熟悉的生活情境（买文具、坐公交、分零食、打球计分等），但第一优先是题目本身要站得住：条件自洽、所求量与答案对得上（问「几本书」答案就得是几本）、考查的知识点和原题一致。不要为了凑生活情境，改编出逻辑矛盾或答非所问的题，也别用成人职场或工程术语。每道题的 analysis 也要用上面这位老师的口气讲，不要写成干巴巴的标准答案。

【最重要：答案与解析必须绝对一致】
请先详细推导解析，得出最终结果后，再将该结果填入答案字段，确保两者绝对一致。
逐题执行以下顺序，不得颠倒：
1. 先出题，把数据设计成能算出简洁结果（优先整数或简单分数，不要构造无解或结果极复杂的式子）；在心里完成一遍完整计算/推理，把关键算式与推导过程写进 analysis，只有确有贴切类比时才加一句，没有就省略，每题解析控制在 150 字以内、别绕圈子。analysis 的最后一句必须写成「所以 x = 5」这样的具体结论句，直接给出题目所求量的最终值，不能停在中间量（例如题目求 x^z，末句就要写出 x^z 等于多少），明确写出最终数值，禁止使用省略号、占位符或重复的等号链。
2. 再把上一步得到的最终结果原样抄进 answer，不要重新估算、不要凭印象另写一个数。
3. 输出前逐题自检：answer 的值必须就是 analysis 最后得出的结论；若两者不一致，必须重新推导并改正，绝不允许出现「解析算到 5、答案却写 1」这类矛盾。
注意：不要在解析里留下与答案不同的另一个结论；易错提醒若举例错误答案，必须明确标注「错误」。

只输出一个严格的 JSON 对象（不要 Markdown 代码块、不要解释文字），字段顺序固定为 analysis 在 answer 之前：
{"items":[{"question":"题干","analysis":"完整推导过程，用初中老师讲题的口气（开头一句轻松话，确有贴切类比才加一句），最后一句必须明确写出最终结果与依据","answer":"把上面解析最终得到的结论原样填入，必须与解析最后一步完全一致","knowledgePoints":["知识点"],"difficulty":"基础|中等|较难|压轴"}]}
要求：题目完整可独立作答；涉及计算必须在 analysis 中写出关键算式并核算一遍，负数乘方要写清是几个数相乘、别把立方说成平方；按「基础 → 中等 → 较难」排列；全部使用简体中文；只输出 JSON。`;

/* ---------------- 演示数据：无 Key 时也能完整体验 ---------------- */
const DEMO_BANK = {
  '数学': [
    { question: '解方程：x² − 5x + 6 = 0，并写出两根之和。', myAnswer: 'x = 1 或 x = 6', answer: 'x₁ = 2，x₂ = 3；两根之和为 5', analysis: '因式分解得 (x−2)(x−3)=0，所以两根为 2 和 3。也可用韦达定理验证：x₁+x₂ = −b/a = 5。易错点：把常数项 6 拆成 1×6 而忽略一次项 −5，应先找两数之积为 6、之和为 5。', knowledgePoints: ['一元二次方程', '因式分解', '韦达定理'], difficulty: '基础', cause: '计算失误', note: '解完后把根代回原方程验算一遍。' },
    { question: '已知一次函数 y = kx + b 的图象经过点 (0, 3) 和 (2, 7)，求 k 与 b 的值。', myAnswer: 'k = 2, b = 1', answer: 'k = 2，b = 3', analysis: '把 (0,3) 代入得 b = 3；再把 (2,7) 代入得 7 = 2k + 3，解得 k = 2。与 y 轴交点的纵坐标就是 b，这是最快的一步。', knowledgePoints: ['一次函数', '待定系数法'], difficulty: '基础', cause: '概念不清', note: '记住 b 就是图象与 y 轴交点的纵坐标。' }
  ],
  '语文': [
    { question: '默写陶渊明《饮酒（其五）》中的名句：__________，悠然见南山。', myAnswer: '采菊东离下', answer: '采菊东篱下', analysis: '出自陶渊明《饮酒（其五）》。「篱」指篱笆，是竹字头，不要写成「离」。整句写诗人闲适自得的心境，与后文「此中有真意，欲辨已忘言」呼应。', knowledgePoints: ['古诗文默写', '易错字形'], difficulty: '基础', cause: '粗心笔误', note: '默写题把易错字单独抄三遍。' },
    { question: '下列句子没有语病的一项是（　）\nA. 通过这次活动，使我明白了团结的重要\nB. 能否取得好成绩，取决于平时的努力\nC. 我们要防止不再发生类似事故\nD. 他的写作水平明显改进了', myAnswer: 'B', answer: 'D 有搭配问题，正确项为 B（两面对两面）', analysis: 'A 项「通过…使…」连用导致主语残缺；C 项「防止不再发生」否定不当；D 项「水平」应与「提高」搭配，不能「改进」。做语病题先抓主干，再看搭配与逻辑。', knowledgePoints: ['病句辨析', '成分残缺', '搭配不当'], difficulty: '中等', cause: '思路卡壳', note: '按「主干—搭配—逻辑—重复」四步排查。' }
  ],
  '英语': [
    { question: '用所给词的适当形式填空：He ______ (go) to school by bike every day.', myAnswer: 'go', answer: 'goes', analysis: 'every day 表明是一般现在时；主语 He 是第三人称单数，动词加 -es（go → goes）。牢记「三单 + 动词 s/es」这条主线。', knowledgePoints: ['一般现在时', '主谓一致', '第三人称单数'], difficulty: '基础', cause: '概念不清', note: '看到 always / every day 先想时态，再看主语。' },
    { question: '— Where is your brother?  — He ______ (read) in the library now.', myAnswer: 'reads', answer: 'is reading', analysis: 'now 提示现在进行时，结构为 be + doing；主语 He 搭配 is，故填 is reading。注意与一般现在时的时间标志词区分。', knowledgePoints: ['现在进行时', '时间状语'], difficulty: '基础', cause: '审题偏差', note: '圈出题干里的时间标志词再动笔。' }
  ],
  '物理': [
    { question: '一盏标有「220V 100W」的灯泡正常发光 5 小时，消耗的电能是多少 kW·h？合多少焦耳？', myAnswer: '500 kW·h', answer: '0.5 kW·h，合 1.8×10⁶ J', analysis: '先把功率化成 kW：100 W = 0.1 kW。由 W = Pt 得 W = 0.1 kW × 5 h = 0.5 kW·h。又 1 kW·h = 3.6×10⁶ J，故为 1.8×10⁶ J。易错点：直接用 100×5 得到 500，忽略了单位换算。', knowledgePoints: ['电功率', '电能计算', '单位换算'], difficulty: '中等', cause: '计算失误', note: '计算前统一单位，是物理计算题的第一步。' }
  ],
  '化学': [
    { question: '写出实验室用大理石（或石灰石）与稀盐酸制取二氧化碳的化学方程式。', myAnswer: 'CaCO₃ + HCl = CaCl₂ + H₂O + CO₂', answer: 'CaCO₃ + 2HCl = CaCl₂ + H₂O + CO₂↑', analysis: '反应物为碳酸钙和盐酸，生成氯化钙、水和二氧化碳。必须配平（HCl 前加 2），并标注气体符号「↑」。实验室不用稀硫酸，因为会生成微溶的 CaSO₄ 覆盖在固体表面阻碍反应。', knowledgePoints: ['化学方程式书写', '二氧化碳的实验室制法', '配平'], difficulty: '中等', cause: '公式记错', note: '写完方程式检查「配平、条件、箭头」三件事。' }
  ],
  '生物': [
    { question: '植物进行光合作用的主要场所是细胞中的哪种结构？', myAnswer: '线粒体', answer: '叶绿体', analysis: '叶绿体含叶绿素，是光合作用的场所；线粒体是呼吸作用的主要场所。两者常混淆，可用「光合在叶绿体、释能在线粒体」区分。', knowledgePoints: ['细胞结构', '光合作用'], difficulty: '基础', cause: '概念不清', note: '把叶绿体与线粒体画成对比表记忆。' }
  ],
  '历史': [
    { question: '中国近代史开端的标志性事件是什么？发生于哪一年？', myAnswer: '1911 年辛亥革命', answer: '1840 年鸦片战争', analysis: '1840 年鸦片战争后签订《南京条约》，中国开始沦为半殖民地半封建社会，被公认为中国近代史的开端。辛亥革命（1911）属于近代化探索的重要事件，但不是开端。', knowledgePoints: ['鸦片战争', '中国近代史分期'], difficulty: '基础', cause: '知识点遗忘', note: '按时间轴把 1840 / 1898 / 1911 / 1919 串起来记。' }
  ],
  '地理': [
    { question: '在等高线地形图上，等高线向海拔高处凸出的部位是什么地形？', myAnswer: '山脊', answer: '山谷', analysis: '口诀「凸高为谷，凸低为脊」：等高线向高处凸出是山谷（可能有河流发育），向低处凸出是山脊（分水岭）。可结合河流流向判断。', knowledgePoints: ['等高线地形图', '地形部位判读'], difficulty: '中等', cause: '概念不清', note: '画一张简图，标出山谷与山脊的等高线弯曲方向。' }
  ],
  '道德与法治': [
    { question: '我国的根本政治制度是什么？', myAnswer: '社会主义制度', answer: '人民代表大会制度', analysis: '人民代表大会制度是我国的根本政治制度；社会主义制度是我国的根本制度；民族区域自治制度、基层群众自治制度等属于基本政治制度。注意「根本制度」与「根本政治制度」的区别。', knowledgePoints: ['政治制度', '人民代表大会制度'], difficulty: '基础', cause: '概念不清', note: '把易混概念整理成对照表。' }
  ],
  '其他': [
    { question: '（示例）请写出本题的正确答案并说明依据。', myAnswer: '', answer: '请参考课本对应章节', analysis: '这是演示模式生成的示例题目。配置 AI 密钥后，拍照上传即可自动识别真实题目并生成完整解析。', knowledgePoints: ['示例知识点'], difficulty: '中等', cause: '其他', note: '在「设置」中配置 AI 后可体验真实识别。' }
  ]
};

const DEMO_SIMILAR = {
  '数学': [
    { question: '解方程：x² − 7x + 12 = 0，并写出两根之和。', answer: 'x₁ = 3，x₂ = 4；两根之和为 7', analysis: '找两数积为 12、和为 7，即 3 和 4；(x−3)(x−4)=0。韦达定理可验证和为 7。', knowledgePoints: ['一元二次方程', '因式分解'], difficulty: '基础' },
    { question: '解方程：2x² − 5x − 3 = 0。', answer: 'x₁ = 3，x₂ = −1/2', analysis: '二次项系数不为 1，可用十字相乘：(2x+1)(x−3)=0；也可用求根公式。注意符号。', knowledgePoints: ['一元二次方程', '十字相乘'], difficulty: '中等' },
    { question: '已知关于 x 的方程 x² − (m+1)x + m = 0 的一个根为 2，求 m 及另一个根。', answer: 'm = 2，另一根为 1', analysis: '把 x=2 代入得 4 − 2(m+1) + m = 0，解得 m = 2；再由两根之积为 m 得另一根为 1。', knowledgePoints: ['一元二次方程', '韦达定理'], difficulty: '较难' }
  ],
  '语文': [
    { question: '默写：山气日夕佳，__________。', answer: '飞鸟相与还', analysis: '出自《饮酒（其五）》，注意「与」不要漏写。', knowledgePoints: ['古诗文默写'], difficulty: '基础' },
    { question: '下列句子没有语病的一项是（　）\nA. 为了避免不再迟到，他提前半小时出门\nB. 通过这次研学，同学们增长了见识\nC. 他的学习成绩不断改进\nD. 是否努力，是取得好成绩的关键之一', answer: 'B', analysis: 'A 否定不当；C「成绩」应搭配「提高」；D 两面对一面。', knowledgePoints: ['病句辨析'], difficulty: '中等' },
    { question: '修改病句：为了防止交通事故不再发生，交警加强了巡查。', answer: '删去「不」，改为「为了防止交通事故发生，交警加强了巡查。」', analysis: '「防止」本身含否定意味，与「不再」叠加造成语义相反。', knowledgePoints: ['病句辨析', '否定不当'], difficulty: '较难' }
  ],
  '英语': [
    { question: 'She ______ (watch) TV every evening.', answer: 'watches', analysis: 'every evening 表一般现在时，主语 She 为三单，watch 以 ch 结尾加 -es。', knowledgePoints: ['一般现在时', '第三人称单数'], difficulty: '基础' },
    { question: 'Listen! The boys ______ (sing) in the classroom.', answer: 'are singing', analysis: 'Listen! 是现在进行时的标志，主语复数用 are。', knowledgePoints: ['现在进行时'], difficulty: '中等' },
    { question: '用所给词的适当形式填空：Neither Tom nor his friends ______ (be) interested in the film.', answer: 'are', analysis: 'neither…nor… 遵循就近原则，靠近动词的 his friends 是复数，故用 are。', knowledgePoints: ['主谓一致', '就近原则'], difficulty: '较难' }
  ],
  '物理': [
    { question: '一台 200 W 的电视机正常工作 3 小时，耗电多少 kW·h？', answer: '0.6 kW·h', analysis: '200 W = 0.2 kW，W = Pt = 0.2 × 3 = 0.6 kW·h。', knowledgePoints: ['电功率', '电能计算'], difficulty: '基础' },
    { question: '某电热器标有「220V 1000W」，正常工作时的电阻是多少 Ω？', answer: '48.4 Ω', analysis: '由 P = U²/R 得 R = U²/P = 220²/1000 = 48.4 Ω。', knowledgePoints: ['电功率', '欧姆定律'], difficulty: '中等' },
    { question: '将「220V 100W」的灯泡接在 110V 电源上（电阻不变），实际功率是多少？', answer: '25 W', analysis: '电阻不变时 P 与 U² 成正比，电压减半则功率变为原来的 1/4，即 25 W。', knowledgePoints: ['额定功率', '实际功率'], difficulty: '较难' }
  ],
  '化学': [
    { question: '写出实验室用过氧化氢制取氧气的化学方程式。', answer: '2H₂O₂ --MnO₂--> 2H₂O + O₂↑', analysis: 'MnO₂ 作催化剂写在箭头上方，注意配平与气体符号。', knowledgePoints: ['化学方程式', '氧气的实验室制法'], difficulty: '基础' },
    { question: '写出碳酸钠与稀盐酸反应的化学方程式。', answer: 'Na₂CO₃ + 2HCl = 2NaCl + H₂O + CO₂↑', analysis: '碳酸盐与酸反应生成盐、水和二氧化碳，注意钠原子守恒需 2NaCl。', knowledgePoints: ['化学方程式', '配平'], difficulty: '中等' },
    { question: '用化学方程式解释：为什么不能用铁桶盛放硫酸铜溶液？', answer: 'Fe + CuSO₄ = FeSO₄ + Cu', analysis: '铁比铜活泼，会把铜置换出来，既腐蚀铁桶又使溶液变质。', knowledgePoints: ['金属活动性顺序', '置换反应'], difficulty: '较难' }
  ]
};
const DEMO_SIMILAR_GENERIC = [
  { question: '（变式 1）围绕本题核心知识点，改换条件后再做一次，并写出完整解题过程。', answer: '请对照原题解析中的步骤自行作答', analysis: '这一类题的关键是先辨认考查的知识点，再套用对应的解题模型。', knowledgePoints: ['知识点巩固'], difficulty: '基础' },
  { question: '（变式 2）把原题的设问反过来：若已知结论，能否倒推出题设中的关键条件？', answer: '可以，依据定义与判定定理逆向推理', analysis: '逆向设问常用来检验概念是否真正理解，而不只是记住步骤。', knowledgePoints: ['逆向思维'], difficulty: '中等' },
  { question: '（变式 3）本题与本章另一个知识点综合出题时，需要补充哪些条件？请列举并解答。', answer: '开放题，答案不唯一', analysis: '综合题的突破口通常是找到两个知识点之间的公共量或共通条件。', knowledgePoints: ['综合应用'], difficulty: '较难' }
];

/* ---------------- 主体 ---------------- */
const AI = (function () {
  const KEY = 'ctb_settings_v2'; // v2：默认切换为智谱双模型，避免旧版单模型配置残留
  const defaults = {
    aiMode: 'auto', provider: 'zhipu', baseUrl: PRESETS.zhipu.baseUrl, apiKey: '',
    model: PRESETS.zhipu.model, textModel: PRESETS.zhipu.textModel
  };
  let proxyState = null; // null=未探测 | 'ready' | 'nokey' | false
  let proxyInfo = null;

  function getSettings() {
    try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return Object.assign({}, defaults); }
  }
  function saveSettings(s) {
    localStorage.setItem(KEY, JSON.stringify(Object.assign({}, getSettings(), s)));
    proxyState = null;
    proxyInfo = null;
  }
  function applyPreset(name) {
    const p = PRESETS[name] || PRESETS.custom;
    saveSettings({ provider: name, baseUrl: p.baseUrl, model: p.model, textModel: p.textModel });
    return getSettings();
  }

  async function detectProxy() {
    if (proxyState !== null) return proxyState;
    if (location.protocol === 'file:') { proxyState = false; return false; }
    try {
      const r = await fetch('/api/ping', { signal: AbortSignal.timeout(2500) });
      const j = await r.json();
      proxyInfo = j;
      proxyState = j.configured ? 'ready' : 'nokey';
    } catch (e) { proxyState = false; }
    return proxyState;
  }

  async function resolveMode() {
    const s = getSettings();
    if (s.aiMode === 'demo') return 'demo';
    const p = await detectProxy();
    if (s.aiMode === 'proxy') return p === 'ready' ? 'proxy' : 'demo';
    if (s.aiMode === 'direct') return s.apiKey && s.baseUrl ? 'direct' : 'demo';
    if (p === 'ready') return 'proxy';
    if (s.apiKey && s.baseUrl) return 'direct';
    return 'demo';
  }

  async function status() {
    const s = getSettings();
    const p = await detectProxy();
    const m = await resolveMode();
    const own = resolveModels();
    if (m === 'proxy') {
      const models = (proxyInfo && proxyInfo.models) || own;
      return { mode: 'proxy', ok: true, label: '本地代理已就绪 · 识别 ' + models.vision + ' / 解析 ' + models.text, demo: false };
    }
    if (m === 'direct') return { mode: 'direct', ok: true, label: '浏览器直连 · 识别 ' + own.vision + ' / 解析 ' + own.text, demo: false };
    let extra = '';
    if (s.aiMode === 'proxy' && p === 'nokey') extra = '（本地服务未配置 apiKey）';
    else if (s.aiMode === 'proxy' && p === false) extra = '（未检测到本地服务，请运行 start.bat）';
    else if (s.aiMode === 'direct' && !s.apiKey) extra = '（尚未填写 API Key）';
    else if (p === 'nokey') extra = '（本地服务未配置 apiKey）';
    return { mode: 'demo', ok: true, label: '演示模式' + extra + ' · 无需联网，使用内置示例数据', demo: true };
  }

  function friendly(e, mode) {
    const msg = (e && e.message) || '未知错误';
    if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
      return mode === 'direct'
        ? '连接失败：可能是接口地址错误或浏览器跨域限制。建议启动 start.bat 并使用「本地代理」模式。'
        : '无法连接本地服务，请确认已运行 start.bat（node server.js）。';
    }
    if (e && e.name === 'TimeoutError') return 'AI 接口响应超时，请稍后重试或更换模型。';
    return msg;
  }

  function extractJSON(text) {
    let s = String(text || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AI 没有返回 JSON 格式内容：' + s.slice(0, 100));
    let core = s.slice(a, b + 1);
    try { return JSON.parse(core); }
    catch (e) {
      core = core.replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(core); }
      catch (e2) { throw new Error('AI 返回内容解析失败：' + core.slice(0, 120)); }
    }
  }

  async function chat(messages, opts = {}) {
    const s = getSettings();
    const mode = await resolveMode();
    if (mode === 'demo') throw new Error('DEMO_MODE');

    const checked = validateMessages(messages);
    const models = resolveModels();
    // 只要 content 里有图片就强制 vision；绝不把 image_url 发给文本模型（否则智谱返回 1210）
    const task = checked.hasImage ? 'vision' : (opts.task === 'vision' ? 'vision' : 'text');
    const payload = {
      messages: checked.messages,
      task,
      model: task === 'vision' ? models.vision : models.text,
      temperature: opts.temperature ?? 0.25,
      max_tokens: opts.max_tokens || 2048
    };
    let url, headers;
    if (mode === 'proxy') {
      // 代理模式由服务端按 task 选择模型，密钥不出现在浏览器
      url = '/api/ai';
      headers = { 'Content-Type': 'application/json' };
    } else {
      url = s.baseUrl.replace(/\/+$/, '') + '/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey };
    }
    try {
      const r = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = j.message || (j.error && (j.error.message || j.error)) || ('HTTP ' + r.status);
        if (j.error === 'NO_API_KEY') throw new Error('服务端尚未配置 apiKey：请复制 config.example.json 为 config.json 并填写密钥，或改用浏览器直连。');
        throw new Error('AI 接口返回 ' + r.status + '：' + String(detail).slice(0, 220));
      }
      let c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (Array.isArray(c)) c = c.map((x) => x.text || '').join('');
      if (!c) throw new Error('AI 返回内容为空，请检查模型是否支持图片输入。');
      return String(c);
    } catch (e) {
      if (e.message === 'DEMO_MODE') throw e;
      throw new Error(friendly(e, mode));
    }
  }

  async function testConnection() {
    const m = await resolveMode();
    if (m === 'demo') return { ok: true, demo: true, message: '当前为演示模式，无需连接 AI 接口。' };
    try {
      const out = await chat([{ role: 'user', content: '请只回复两个字：正常' }], { task: 'text', max_tokens: 20, temperature: 0 });
      return { ok: true, demo: false, message: '连接成功：' + out.trim().slice(0, 30) };
    } catch (e) { return { ok: false, demo: false, message: e.message }; }
  }

  function str(v) { return v == null ? '' : String(v).trim(); }
  function arr(v) {
    if (Array.isArray(v)) return v.map(str).filter(Boolean).slice(0, 8);
    return str(v).split(/[,，、;；\/]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
  }
  function pick(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }

  /* ---------------- 答案一致性兜底 ----------------
     Prompt 已要求「先推导解析、再把结论填入答案」，但模型仍可能偶发失误。
     当 answer 是单一数值、且 analysis 的结论句能提取最终数值时，
     以解析推导出的结论为准修正 answer，杜绝「解析算到 5、答案写 1」。
     文字答案、复合答案、结论无法判定的情形一律跳过，避免误改。 */
  // 把「答案」或「结论」解析成可比较的值：只接受纯数值与简单分数，其余一律跳过
  function parseValue(text) {
    const s = String(text || '').trim();
    if (!s || s.length > 40) return null;
    const cut = Math.max(s.lastIndexOf('='), s.lastIndexOf('＝'));
    const v = (cut >= 0 ? s.slice(cut + 1) : s).trim().replace(/[，,。．；;、]$/, '').trim();
    let m = v.match(/^([+\-−]?\d+(?:\.\d+)?)$/);
    if (m) return { kind: 'number', value: Number(m[1].replace('−', '-')), raw: m[1] };
    m = v.match(/^([+\-−]?\d+)\s*\/\s*(\d+)$/);
    if (m && Number(m[2]) !== 0) {
      return { kind: 'fraction', value: Number(m[1].replace('−', '-')) / Number(m[2]), raw: m[0] };
    }
    return null;
  }

  function conclusionValue(analysis) {
    const clauses = String(analysis || '')
      .split(/[。．！？!?；;\n]/).map((x) => x.trim()).filter(Boolean);
    if (!clauses.length) return null;
    const last = clauses[clauses.length - 1];
    // 只看最后一句、且必须是明确结论句；中间步骤与「易错举例」不算结论
    if (!/^(?:所以|因此|故|综上|最终|答案|结果|可见|即)/.test(last)) return null;
    const direct = parseValue(last);
    if (direct) return direct;
    const m = last.match(/(?:为|是|得|等于|结果为|答案是)\s*([+\-−]?\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*[，,、]?\s*$/);
    return m ? parseValue(m[1]) : null;
  }

  // 仅当两端都能判定、且类型相同（整数对整数 / 分数对分数）才认为矛盾，避免误改
  function isInconsistent(item) {
    const a = parseValue(item && item.answer);
    const d = conclusionValue(item && item.analysis);
    return !!(a && d && a.kind === d.kind && Math.abs(a.value - d.value) >= 1e-9);
  }

  // 无需修正时原样返回；修正后打上 answerFixed 标记，便于界面提示与自检
  function reconcileAnswer(item) {
    if (!item || !isInconsistent(item)) return item;
    const a = parseValue(item.answer);
    const d = conclusionValue(item.analysis);
    const answer = String(item.answer).replace(a.raw, d.raw);
    return Object.assign({}, item, { answer, answerFixed: true });
  }

  // 兼容旧自检脚本的数值判定入口
  function soleNumber(text) { const v = parseValue(text); return v ? { raw: v.raw, value: v.value } : null; }
  function conclusionNumber(analysis) { const v = conclusionValue(analysis); return v ? v.value : null; }

  function normalize(o, hint) {
    return {
      subject: pick(str(o.subject), SUBJECTS, pick(str(hint), SUBJECTS, '其他')),
      question: str(o.question) || str(o.title) || '（未能识别题干，请手动补充）',
      myAnswer: str(o.myAnswer),
      answer: str(o.answer),
      analysis: str(o.analysis) || str(o.explanation),
      knowledgePoints: arr(o.knowledgePoints),
      difficulty: pick(str(o.difficulty), DIFFICULTIES, '中等'),
      cause: pick(str(o.cause), CAUSES, '其他'),
      note: str(o.note),
      source: 'ai'
    };
  }

  /* 图片一律包成标准结构 {"type":"image_url","image_url":{"url":"..."}}，
     content 里绝不直接放裸 base64、也不出现 base64/image 之类的非法 type。
     url 只使用合法值：data:image/...;base64,... 或 http(s) 链接。
     实测 glm-4v-flash 同时接受 data URL 与纯 base64，data URL 还兼容其它 OpenAI 服务。 */
  function imageUrlFor(dataUrl) {
    const v = String(dataUrl || '').trim();
    if (!v) return '';
    if (/^data:image\//i.test(v) || /^https?:\/\//i.test(v)) return v;
    return 'data:image/jpeg;base64,' + v.replace(/^data:image\/[^;]+;base64,/i, '');
  }
  function textPart(t) { return { type: 'text', text: String(t) }; }
  function imagePart(dataUrl) {
    const url = imageUrlFor(dataUrl);
    if (!url) throw new Error('图片内容为空，请重新拍照');
    return { type: 'image_url', image_url: { url } };
  }

  // content 片段只允许 text / image_url；其它 type 一律丢弃（智谱对非法 type 返回 400）
  function validateMessages(messages) {
    let hasImage = false;
    const clean = messages.map((m) => {
      if (!Array.isArray(m.content)) return m;
      const parts = m.content.filter((p) => p && (p.type === 'text' || p.type === 'image_url'));
      parts.forEach((p) => { if (p.type === 'image_url' && p.image_url && p.image_url.url) hasImage = true; });
      return Object.assign({}, m, { content: parts });
    });
    return { messages: clean, hasImage };
  }

  // 智谱场景强制：带图识别用视觉模型、纯文本推理用文本模型，防止误配触发 1210
  function resolveModels() {
    const s = getSettings();
    const zhipu = s.provider === 'zhipu' || /bigmodel\.cn/.test(s.baseUrl || '');
    let vision = s.model || PRESETS.zhipu.model;
    let text = s.textModel || s.model || PRESETS.zhipu.textModel;
    if (zhipu) {
      if (!/v-|vision|vl|image/i.test(vision)) vision = PRESETS.zhipu.model;  // glm-4v-flash
      if (/v-|vision|vl|image/i.test(text)) text = PRESETS.zhipu.textModel;   // glm-4-flash
    }
    return { vision, text };
  }

  function firstNonEmpty(list, key) {
    for (let i = 0; i < list.length; i += 1) {
      const v = str(list[i] && list[i][key]);
      if (v) return v;
    }
    return '';
  }

  // glm-4v-flash 单次仅支持 1 张图，多图逐张识别后合并
  function mergeVisionParts(parts, hint) {
    const first = parts[0] || {};
    const questions = parts.map((p) => str(p.question)).filter((q) => q && q.indexOf('未能识别') < 0);
    const kps = [];
    parts.forEach((p) => arr(p.knowledgePoints).forEach((k) => { if (kps.indexOf(k) < 0) kps.push(k); }));
    return {
      subject: str(first.subject) || hint,
      question: questions.length > 1
        ? questions.map((q, i) => '（图 ' + (i + 1) + '）' + q).join('\n\n')
        : (questions[0] || ''),
      myAnswer: firstNonEmpty(parts, 'myAnswer'),
      answer: firstNonEmpty(parts, 'answer'),
      analysis: '',
      knowledgePoints: kps,
      difficulty: str(first.difficulty),
      cause: str(first.cause),
      note: ''
    };
  }

  function buildAnalysisPrompt(base) {
    return [
      '学科：' + base.subject,
      '题干：' + base.question,
      '学生作答：' + (base.myAnswer || '（未识别到）'),
      '参考答案：' + (base.answer || '（图片中没有，请你自行解答）'),
      '知识点：' + (base.knowledgePoints || []).join('、'),
      '难度：' + base.difficulty,
      '初步判断的错因：' + base.cause
    ].join('\n');
  }

  function demoRecognize(hint) {
    const list = DEMO_BANK[hint] || DEMO_BANK['其他'];
    const base = list[Math.floor(Math.random() * list.length)];
    return new Promise((resolve) => setTimeout(() => resolve(Object.assign({}, base, {
      subject: DEMO_BANK[hint] ? hint : '数学',
      knowledgePoints: base.knowledgePoints.slice(),
      note: (base.note || '') + '　【演示模式示例数据，可自行修改】',
      source: 'demo'
    })), 700));
  }

  async function recognize(images, hint) {
    const mode = await resolveMode();
    if (mode === 'demo' || !images || !images.length) return demoRecognize(hint);

    // —— 阶段一：视觉模型逐张看图识字（glm-4v-flash 单次只接受 1 张图）——
    const parts = [];
    for (let i = 0; i < images.length; i += 1) {
      const content = [
        textPart('请识别第 ' + (i + 1) + ' 张错题图片并整理成档案。用户预设学科：' + (hint || '未指定，请自行判断') + '。只做识别，不要写解析，只输出 JSON。'),
        imagePart(images[i])
      ];
      // glm-4v-flash 的 max_tokens 上限为 1024，超过会返回 400
      const raw = await chat([{ role: 'system', content: SYS_RECOGNIZE }, { role: 'user', content }], { task: 'vision', max_tokens: 1024 });
      parts.push(extractJSON(raw));
    }
    const base = normalize(mergeVisionParts(parts, hint), hint);

    // —— 阶段二：文本模型生成分步解析（glm-4-flash）——
    // 解析失败不阻断录入，保留识别结果并在解析栏提示手动补充
    try {
      const raw = await chat([
        { role: 'system', content: SYS_ANALYSIS },
        { role: 'user', content: '请用有耐心、会打生活比方的初中老师口气，为以下错题撰写解析，让初中生一看就懂，只输出 JSON：\n\n' + buildAnalysisPrompt(base) }
      ], { task: 'text', max_tokens: 1000, temperature: 0.3 });
      const o = extractJSON(raw);
      return reconcileAnswer(Object.assign({}, base, {
        answer: str(o.answer) || base.answer,
        analysis: str(o.analysis) || base.analysis,
        knowledgePoints: arr(o.knowledgePoints).length ? arr(o.knowledgePoints) : base.knowledgePoints,
        cause: pick(str(o.cause), CAUSES, base.cause),
        note: str(o.note) || base.note
      }));
    } catch (e) {
      return Object.assign({}, base, {
        analysis: base.analysis || '（解析生成失败：' + String(e.message || e).slice(0, 60) + '，可在编辑页手动补充）'
      });
    }
  }

  function demoSimilar(item) {
    const list = DEMO_SIMILAR[item.subject] || DEMO_SIMILAR_GENERIC;
    return new Promise((resolve) => setTimeout(() => resolve({
      items: list.map((x) => Object.assign({}, x, { knowledgePoints: x.knowledgePoints.slice() })),
      source: 'demo'
    }), 650));
  }

  async function similar(item) {
    const mode = await resolveMode();
    if (mode === 'demo') return demoSimilar(item);
    const brief = [
      '学科：' + item.subject,
      '原题：' + item.question,
      '正确答案：' + (item.answer || '未提供'),
      '考查知识点：' + (item.knowledgePoints || []).join('、'),
      '难度：' + item.difficulty,
      '学生错因：' + item.cause
    ].join('\n');
    const raw = await chat([
      { role: 'system', content: SYS_SIMILAR },
      { role: 'user', content: '请根据以下错题生成 3 道举一反三的同类题，条件要自洽、问什么答什么，解析用大白话讲、确有贴切类比再用一句。请先详细推导解析、得出最终结果后，再把该结果填入答案字段，并逐题自检两者绝对一致。只输出 JSON：\n\n' + brief }
    ], { task: 'text', max_tokens: 2200, temperature: 0.3 });
    const obj = extractJSON(raw);
    const items = (Array.isArray(obj.items) ? obj.items : []).slice(0, 3).map((x) => ({
      question: str(x.question), answer: str(x.answer), analysis: str(x.analysis),
      knowledgePoints: arr(x.knowledgePoints), difficulty: pick(str(x.difficulty), DIFFICULTIES, item.difficulty)
    })).filter((x) => x.question).map(reconcileAnswer);
    if (!items.length) throw new Error('AI 未生成有效题目，请重试。');
    return { items, source: 'ai' };
  }

  function compressImage(file, maxSide = 1500, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解码失败，请换一张图片'));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  return {
    getSettings, saveSettings, applyPreset, resolveMode, status, testConnection,
    recognize, similar, compressImage, detectProxy, reconcileAnswer,
    // 供自检脚本验证请求体结构与答案一致性
    __internal: { imagePart, textPart, validateMessages, resolveModels, imageUrlFor, parseValue, conclusionValue, isInconsistent, soleNumber, conclusionNumber, reconcileAnswer, TEACHER_STYLE, SYS_RECOGNIZE, SYS_SIMILAR, SYS_ANALYSIS }
  };
})();
