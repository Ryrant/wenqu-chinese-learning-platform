export const practiceCharacters = [
  { character: "人", pinyin: "rén", word: "家人", example: "我喜欢和家人一起吃饭。" },
  { character: "日", pinyin: "rì", word: "日出", example: "我们在山上看日出。" },
  { character: "月", pinyin: "yuè", word: "月亮", example: "今晚的月亮又大又圆。" },
  { character: "山", pinyin: "shān", word: "高山", example: "远处有一座高山。" },
  { character: "水", pinyin: "shuǐ", word: "喝水", example: "运动以后要记得喝水。" },
  { character: "木", pinyin: "mù", word: "树木", example: "公园里的树木长高了。" },
  { character: "天", pinyin: "tiān", word: "天空", example: "蓝蓝的天空中飘着白云。" },
  { character: "地", pinyin: "dì", word: "大地", example: "春天来了，大地变绿了。" },
  { character: "中", pinyin: "zhōng", word: "中文", example: "我正在学习中文。" },
  { character: "文", pinyin: "wén", word: "文化", example: "我们一起了解中国文化。" },
  { character: "学", pinyin: "xué", word: "学校", example: "我在学校认识了新朋友。" },
  { character: "习", pinyin: "xí", word: "练习", example: "每天练习，慢慢进步。" },
] as const;

export type PracticeCharacter = typeof practiceCharacters[number];
