export type ReadingTerm = { word: string; pinyin: string; meaning: string };
export type ReadingLesson = { id: string; title: string; level: string; sentences: string[]; terms: ReadingTerm[]; focusWords: string[] };

const commonTerms: ReadingTerm[] = [
  { word: "我", pinyin: "wǒ", meaning: "说话的人自己。" },
  { word: "我们", pinyin: "wǒ men", meaning: "包括说话人在内的几个人。" },
  { word: "他", pinyin: "tā", meaning: "说到的另一个人。" },
  { word: "她", pinyin: "tā", meaning: "说到的另一个女性。" },
  { word: "和", pinyin: "hé", meaning: "表示一起，或连接两个人、两件事。" },
  { word: "的", pinyin: "de", meaning: "连接修饰语和后面的事物。" },
  { word: "了", pinyin: "le", meaning: "表示动作完成或情况发生变化。" },
  { word: "在", pinyin: "zài", meaning: "表示所在的地方或正在做的动作。" },
  { word: "有", pinyin: "yǒu", meaning: "表示存在或拥有。" },
  { word: "很", pinyin: "hěn", meaning: "表示程度比较高。" },
  { word: "是", pinyin: "shì", meaning: "用来说明人或事物是什么。" },
  { word: "把", pinyin: "bǎ", meaning: "引出动作要处理的对象。" },
  { word: "给", pinyin: "gěi", meaning: "送交别人，或表示动作的对象。" },
  { word: "说", pinyin: "shuō", meaning: "用话表达意思。" },
  { word: "看", pinyin: "kàn", meaning: "用眼睛了解事物。" },
  { word: "去", pinyin: "qù", meaning: "从这里到另一个地方。" },
  { word: "一起", pinyin: "yì qǐ", meaning: "几个人共同做一件事。" },
  { word: "一个", pinyin: "yí ge", meaning: "表示数量为一的人或事物。" },
  { word: "一本", pinyin: "yì běn", meaning: "表示书的数量为一。" },
  { word: "一张", pinyin: "yì zhāng", meaning: "表示卡片等薄片物品的数量为一。" },
  { word: "也", pinyin: "yě", meaning: "表示同样的情况。" },
  { word: "这", pinyin: "zhè", meaning: "指比较近的人或事物。" },
  { word: "着", pinyin: "zhe", meaning: "表示动作或状态持续。" },
];

export const readingLessons: ReadingLesson[] = [
  {
    id: "park-morning", title: "公园的早晨", level: "A1",
    sentences: ["星期天早上，我和家人一起去公园。", "公园里有高高的树，也有小小的花。", "妈妈在湖边散步，爸爸在树下看书。", "我看见一只小鸟，轻轻地和它打招呼。", "回家的时候，我们把垃圾放进垃圾桶。", "干净的公园，让大家都很开心。"],
    focusWords: ["公园", "散步", "湖边", "打招呼", "垃圾桶", "干净"],
    terms: [
      { word: "星期天", pinyin: "xīng qī tiān", meaning: "一周中的星期日。" },
      { word: "早上", pinyin: "zǎo shang", meaning: "一天开始后、上午较早的时候。" },
      { word: "家人", pinyin: "jiā rén", meaning: "自己家庭里的成员。" },
      { word: "公园", pinyin: "gōng yuán", meaning: "供大家休息、游玩的公共园地。" },
      { word: "里", pinyin: "lǐ", meaning: "某个地方的内部。" },
      { word: "高高", pinyin: "gāo gāo", meaning: "形容高度很高。" },
      { word: "树", pinyin: "shù", meaning: "有木质树干的植物。" },
      { word: "小小", pinyin: "xiǎo xiǎo", meaning: "形容体积很小。" },
      { word: "花", pinyin: "huā", meaning: "植物上常有颜色和香气的部分。" },
      { word: "妈妈", pinyin: "mā ma", meaning: "母亲的称呼。" },
      { word: "湖边", pinyin: "hú biān", meaning: "湖水旁边的地方。" },
      { word: "散步", pinyin: "sàn bù", meaning: "为了休息、放松而慢慢走路。" },
      { word: "爸爸", pinyin: "bà ba", meaning: "父亲的称呼。" },
      { word: "树下", pinyin: "shù xià", meaning: "树的下面。" },
      { word: "看书", pinyin: "kàn shū", meaning: "阅读书里的内容。" },
      { word: "看见", pinyin: "kàn jiàn", meaning: "通过眼睛发现了事物。" },
      { word: "一只", pinyin: "yì zhī", meaning: "表示鸟等动物的数量为一。" },
      { word: "小鸟", pinyin: "xiǎo niǎo", meaning: "体型较小的鸟。" },
      { word: "轻轻", pinyin: "qīng qīng", meaning: "动作或声音不重。" },
      { word: "地", pinyin: "de", meaning: "连接动作和说明动作方式的词。" },
      { word: "它", pinyin: "tā", meaning: "指说到的动物或事物。" },
      { word: "打招呼", pinyin: "dǎ zhāo hu", meaning: "见面时用语言或动作表示问候。" },
      { word: "回家", pinyin: "huí jiā", meaning: "返回自己的家。" },
      { word: "时候", pinyin: "shí hou", meaning: "某一段时间或某个时刻。" },
      { word: "垃圾", pinyin: "lā jī", meaning: "需要丢弃的废物。" },
      { word: "放进", pinyin: "fàng jìn", meaning: "把东西放到某处里面。" },
      { word: "垃圾桶", pinyin: "lā jī tǒng", meaning: "专门用来装垃圾的容器。" },
      { word: "干净", pinyin: "gān jìng", meaning: "没有污垢、尘土或垃圾。" },
      { word: "让", pinyin: "ràng", meaning: "使某种情况发生。" },
      { word: "大家", pinyin: "dà jiā", meaning: "某个范围里的所有人。" },
      { word: "都", pinyin: "dōu", meaning: "表示全部包括在内。" },
      { word: "开心", pinyin: "kāi xīn", meaning: "心情快乐。" },
    ],
  },
  {
    id: "birthday-card", title: "给奶奶的礼物", level: "A2",
    sentences: ["今天是奶奶的生日，我想准备一份特别的礼物。", "商店里的礼物很多，我却不知道选什么。", "妈妈说，亲手做的东西也很珍贵。", "我画了一张卡片，写上对奶奶的祝福。", "奶奶收到卡片，笑着给我一个拥抱。", "我明白了，心意比价格更重要。"],
    focusWords: ["准备", "特别", "亲手", "珍贵", "祝福", "心意"],
    terms: [
      { word: "今天", pinyin: "jīn tiān", meaning: "说话时所在的这一天。" },
      { word: "奶奶", pinyin: "nǎi nai", meaning: "父亲的母亲。" },
      { word: "生日", pinyin: "shēng rì", meaning: "每年纪念出生的日子。" },
      { word: "想", pinyin: "xiǎng", meaning: "心里希望做某件事。" },
      { word: "准备", pinyin: "zhǔn bèi", meaning: "为了将要做的事先安排好。" },
      { word: "一份", pinyin: "yí fèn", meaning: "表示礼物等物品的一件或一套。" },
      { word: "特别", pinyin: "tè bié", meaning: "与平常不一样。" },
      { word: "礼物", pinyin: "lǐ wù", meaning: "为了表达心意而送给别人的东西。" },
      { word: "商店", pinyin: "shāng diàn", meaning: "出售商品的地方。" },
      { word: "里", pinyin: "lǐ", meaning: "某个地方的内部。" },
      { word: "多", pinyin: "duō", meaning: "数量大。" },
      { word: "却", pinyin: "què", meaning: "表示情况发生转折。" },
      { word: "不知道", pinyin: "bù zhī dào", meaning: "还不了解或不能确定。" },
      { word: "选", pinyin: "xuǎn", meaning: "从几种事物里挑出需要的。" },
      { word: "什么", pinyin: "shén me", meaning: "用来询问人、事物或情况。" },
      { word: "妈妈", pinyin: "mā ma", meaning: "母亲的称呼。" },
      { word: "亲手", pinyin: "qīn shǒu", meaning: "自己动手完成。" },
      { word: "做", pinyin: "zuò", meaning: "制作或进行某件事。" },
      { word: "东西", pinyin: "dōng xi", meaning: "泛指各种物品。" },
      { word: "珍贵", pinyin: "zhēn guì", meaning: "价值大、值得重视和爱惜。" },
      { word: "画", pinyin: "huà", meaning: "用笔等工具描绘形象。" },
      { word: "卡片", pinyin: "kǎ piàn", meaning: "用来记录或表达内容的小纸片。" },
      { word: "写上", pinyin: "xiě shàng", meaning: "把文字写到物品上。" },
      { word: "对", pinyin: "duì", meaning: "表示动作或感情所指向的对象。" },
      { word: "祝福", pinyin: "zhù fú", meaning: "表达希望别人幸福、顺利的心愿。" },
      { word: "收到", pinyin: "shōu dào", meaning: "接到别人送来的东西。" },
      { word: "笑", pinyin: "xiào", meaning: "露出高兴的表情。" },
      { word: "拥抱", pinyin: "yōng bào", meaning: "用双臂把对方抱住。" },
      { word: "明白", pinyin: "míng bai", meaning: "理解了事物的意思或道理。" },
      { word: "心意", pinyin: "xīn yì", meaning: "表达出来的情意和想法。" },
      { word: "比", pinyin: "bǐ", meaning: "用来比较两个事物。" },
      { word: "价格", pinyin: "jià gé", meaning: "购买东西需要付的钱数。" },
      { word: "更", pinyin: "gèng", meaning: "表示程度进一步增加。" },
      { word: "重要", pinyin: "zhòng yào", meaning: "意义大，需要认真对待。" },
    ],
  },
  {
    id: "library-friend", title: "图书馆的新朋友", level: "A2",
    sentences: ["放学以后，小林第一次走进学校的图书馆。", "他想借一本故事书，却找不到书架。", "一位同学主动过来，带他找到需要的书。", "小林轻声说谢谢，两个人一起读了起来。", "离开以前，他们把书放回原处。", "小林不仅借到了书，也交到了新朋友。"],
    focusWords: ["图书馆", "故事书", "主动", "轻声", "原处", "朋友"],
    terms: [
      { word: "放学", pinyin: "fàng xué", meaning: "学校一天的课程结束。" },
      { word: "以后", pinyin: "yǐ hòu", meaning: "某个时间或动作之后。" },
      { word: "小林", pinyin: "xiǎo lín", meaning: "这篇故事中人物的名字。" },
      { word: "第一次", pinyin: "dì yī cì", meaning: "从前没有经历过的头一次。" },
      { word: "走进", pinyin: "zǒu jìn", meaning: "走到某个地方的里面。" },
      { word: "学校", pinyin: "xué xiào", meaning: "老师教学、学生学习的地方。" },
      { word: "图书馆", pinyin: "tú shū guǎn", meaning: "收藏图书，供人阅读和借阅的地方。" },
      { word: "想", pinyin: "xiǎng", meaning: "心里希望做某件事。" },
      { word: "借", pinyin: "jiè", meaning: "暂时取用别人的东西，以后归还。" },
      { word: "故事书", pinyin: "gù shi shū", meaning: "用文字或图画讲述故事的书。" },
      { word: "却", pinyin: "què", meaning: "表示情况发生转折。" },
      { word: "找不到", pinyin: "zhǎo bu dào", meaning: "寻找后仍没有发现。" },
      { word: "书架", pinyin: "shū jià", meaning: "用来摆放书的架子。" },
      { word: "一位", pinyin: "yí wèi", meaning: "表示一个人，带有礼貌意味。" },
      { word: "同学", pinyin: "tóng xué", meaning: "一起在学校学习的人。" },
      { word: "主动", pinyin: "zhǔ dòng", meaning: "不等别人要求就自己行动。" },
      { word: "过来", pinyin: "guò lái", meaning: "从别处来到说话人这里。" },
      { word: "带", pinyin: "dài", meaning: "领着别人一起行动。" },
      { word: "找到", pinyin: "zhǎo dào", meaning: "经过寻找后发现。" },
      { word: "需要", pinyin: "xū yào", meaning: "因为有用而想得到或必须有。" },
      { word: "书", pinyin: "shū", meaning: "把文字、图画装订在一起的读物。" },
      { word: "轻声", pinyin: "qīng shēng", meaning: "用比较小的声音说话。" },
      { word: "谢谢", pinyin: "xiè xie", meaning: "向别人表达感谢。" },
      { word: "两个人", pinyin: "liǎng ge rén", meaning: "表示人数为二。" },
      { word: "读", pinyin: "dú", meaning: "阅读文字或把文字念出来。" },
      { word: "起来", pinyin: "qǐ lái", meaning: "这里表示动作开始进行。" },
      { word: "离开", pinyin: "lí kāi", meaning: "从所在的地方走开。" },
      { word: "以前", pinyin: "yǐ qián", meaning: "某个时间或动作之前。" },
      { word: "他们", pinyin: "tā men", meaning: "指说到的几个人。" },
      { word: "放回", pinyin: "fàng huí", meaning: "把东西放到原来的地方。" },
      { word: "原处", pinyin: "yuán chù", meaning: "原来所在的位置。" },
      { word: "不仅", pinyin: "bù jǐn", meaning: "表示后面还有进一步的情况。" },
      { word: "到", pinyin: "dào", meaning: "这里表示动作取得了结果。" },
      { word: "交", pinyin: "jiāo", meaning: "这里表示结识、建立来往关系。" },
      { word: "新", pinyin: "xīn", meaning: "刚出现或刚认识的。" },
      { word: "朋友", pinyin: "péng you", meaning: "彼此认识、互相友好的人。" },
    ],
  },
];

export function lessonTerms(lesson: ReadingLesson): ReadingTerm[] {
  const terms = new Map(commonTerms.map((term) => [term.word, term]));
  for (const term of lesson.terms) terms.set(term.word, term);
  return [...terms.values()].sort((left, right) => right.word.length - left.word.length);
}

export function readingTokens(sentence: string, lesson: ReadingLesson): Array<ReadingTerm | string> {
  const terms = lessonTerms(lesson); const tokens: Array<ReadingTerm | string> = [];
  for (let offset = 0; offset < sentence.length;) {
    const term = terms.find((candidate) => sentence.startsWith(candidate.word, offset));
    if (term) { tokens.push(term); offset += term.word.length; }
    else { const character = String.fromCodePoint(sentence.codePointAt(offset)!); tokens.push(character); offset += character.length; }
  }
  return tokens;
}

export type ReadingQuestion = { word: string; options: string[]; correctOption: number };
export function createReadingQuiz(lesson: ReadingLesson, random = Math.random): ReadingQuestion[] {
  const terms = lesson.focusWords.map((word) => lesson.terms.find((term) => term.word === word)!);
  function shuffle<T>(items: T[]) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [result[index], result[other]] = [result[other], result[index]]; }
    return result;
  }
  return shuffle(terms).slice(0, 3).map((term) => {
    const options = shuffle([term.meaning, ...shuffle(terms.filter((other) => other.meaning !== term.meaning)).slice(0, 3).map((other) => other.meaning)]);
    return { word: term.word, options, correctOption: options.indexOf(term.meaning) };
  });
}

export type SavedReadingWord = ReadingTerm & { id: string; lessonId: string; lessonTitle: string; example: string; createdAt: string };
